// Phone Twin v4 — shared, engine-light helpers: PLY loading, scan metadata, coordinate frames,
// nearest-surface grid and the UDP line protocol (see PhoneTwin_v4/PROTOCOL.md).
#pragma once

#include "CoreMinimal.h"

namespace PhoneTwin
{
	/** One object from <id>.json: either placed by hand on the phone (bAi=false) or recognised by the phone's AI. */
	struct FScanObject
	{
		int32 Id = 0;           // haptic object id: 1..99 placed, 100+ AI
		FString Label;          // AI label ("chair") or placed name ("사물 1")
		FString Name;           // display name (Korean)
		FVector3f C = FVector3f::ZeroVector;   // centre, S frame (metres, Y up)
		float R = 0.25f;        // radius, metres
		bool bAi = false;
	};

	struct FScanMeta
	{
		FString Id, Created, Device;
		bool bHasAB = false;
		FVector3f A = FVector3f::ZeroVector, B = FVector3f::ZeroVector;
		TArray<FScanObject> Objects;
	};

	struct FScanEntry { FString Id, Ply, Meta, Created, Device; int64 Points = 0; };

	/** Reads x,y,z (+ red,green,blue when present) of the vertex element. ascii / binary LE / binary BE. */
	PHONETWINLINK_API bool LoadPly(const FString& Path, TArray<FVector3f>& OutS, TArray<FColor>& OutColor, FString& OutError);
	/** Binary little-endian PLY, float xyz + uchar rgb (same as the phone writes). */
	PHONETWINLINK_API bool SavePly(const FString& Path, const TArray<FVector3f>& S, const TArray<FColor>& Color);
	PHONETWINLINK_API bool ParseMeta(const FString& Json, FScanMeta& Out);
	PHONETWINLINK_API bool ParseIndex(const FString& Json, TArray<FScanEntry>& Out);

	/**
	 * S frame (phone scan: metres, Y up, right-handed) -> Unreal (cm, Z up, left-handed): (x, z, y) * 100.
	 * With floor marks A/B the result is shifted/rotated so A is the origin and A->B is +X, which makes it the
	 * same space as the ESP32 room frame R.
	 */
	struct PHONETWINLINK_API FScanFrame
	{
		bool bAligned = false;
		FVector Origin = FVector::ZeroVector;   // A in raw Unreal coordinates
		double Cos = 1, Sin = 0;                // rotation that brings A->B onto +X

		static FScanFrame FromMeta(const FScanMeta& Meta);
		static FVector Raw(const FVector3f& S) { return FVector(S.X, S.Z, S.Y) * 100.0; }
		FVector Point(const FVector3f& S) const;
		FVector Dir(const FVector3f& S) const;
	};

	/** R frame (ESP32: metres, Z up, right-handed, +Y left of +X) -> Unreal cm. */
	inline FVector RoomToUnreal(double X, double Y, double Z) { return FVector(X, -Y, Z) * 100.0; }
	/** R yaw is counter-clockwise from above, Unreal yaw is clockwise. */
	inline FRotator RoomRotToUnreal(double Yaw, double Pitch, double Roll) { return FRotator(Pitch, -Yaw, Roll); }

	/**
	 * One representative point per cubic cell (dedup), stored in coarse buckets of 8x8x8 cells so that
	 * nearest-point queries stay cheap for large radii. Unreal units.
	 */
	class PHONETWINLINK_API FPointGrid
	{
	public:
		void Build(const TArray<FVector>& Points, double InCell);
		/** Distance to the nearest point within MaxDist (ignoring points with Z < MinZ), or a huge value. */
		double Nearest(const FVector& Q, double MaxDist, double MinZ, FVector& OutPoint) const;
		int32 Num() const { return Count; }
		bool IsEmpty() const { return Count == 0; }
	private:
		static constexpr int32 Bucket = 8;
		FIntVector BucketKey(const FVector& P) const { const double S = Cell * Bucket; return FIntVector(FMath::FloorToInt(P.X / S), FMath::FloorToInt(P.Y / S), FMath::FloorToInt(P.Z / S)); }
		double Cell = 3;
		int32 Count = 0;
		TMap<FIntVector, TArray<FVector>> Buckets;
	};

	/** Height of the floor: the densest 2 cm layer in the lowest 35% of the cloud (Unreal Z). */
	PHONETWINLINK_API double EstimateFloorZ(const TArray<FVector>& Points);

	// ---- UDP line protocol
	struct FPhonePose { uint32 Seq = 0; bool bValid = false; FVector3f P, F, U; FString ScanId; };
	struct FEspPose { uint32 Seq = 0; bool bValid = false; double X = 0, Y = 0, Z = 0, Yaw = 0, Pitch = 0, Roll = 0; };

	PHONETWINLINK_API bool ParsePTP(const FString& Line, FPhonePose& Out);
	PHONETWINLINK_API bool ParsePTE(const FString& Line, FEspPose& Out);
	PHONETWINLINK_API FString MakePTH(uint32 Seq, bool bValid, float Intensity01, bool bContact, int32 ObjectId, double DistanceCm);

	/** Same curve as the phone app: 0 at Range, 1 at Contact (and closer). */
	inline float Intensity(double Dist, double Range, double Contact)
	{
		const double C = FMath::Min(Contact, Range * 0.9);
		return Dist >= Range ? 0.f : (float)FMath::Clamp((Range - Dist) / (Range - C), 0.0, 1.0);
	}
}
