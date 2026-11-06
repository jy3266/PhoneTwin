// Phone Twin v4 — turns a loaded scan (S frame) into LiDAR point cloud points in Unreal space. Used by the game actor and the editor importer.
#pragma once

#include "CoreMinimal.h"
#include "LidarPointCloudShared.h"
#include "PhoneTwinCore.h"

class UMaterialInterface;
class UMaterial;

namespace PhoneTwin
{
	inline void ToCloudPoints(const TArray<FVector3f>& S, const TArray<FColor>& Color, const FScanFrame& Frame, TArray<FLidarPointCloudPoint>& Out, TArray<FVector>* OutUE = nullptr)
	{
		Out.Reset(S.Num());
		if (OutUE) OutUE->Reset(S.Num());
		for (int32 i = 0; i < S.Num(); i++)
		{
			const FVector P = Frame.Point(S[i]);
			Out.Emplace(FVector3f(P), Color.IsValidIndex(i) ? Color[i] : FColor(170, 170, 170), true, (uint8)0);
			if (OutUE) OutUE->Add(P);
		}
	}

	/** How the scan lights up around the audience (lengths in cm, brightness 0..1 before the component's Gain). */
	struct FGlowParams
	{
		float LitRadius = 120;         // full brightness within this floor distance of the audience
		float FadeRadius = 450;        // dim beyond this
		float NearBrightness = 1.f;
		float FarBrightness = .18f;
		float IdleBrightness = .35f;   // everywhere, while nobody is tracked
		float NearWhite = .35f;        // near points also shift towards white light
		float Twinkle = .2f;           // dim points shimmer softly, 0 = steady
		float Reveal = 1;              // 0 = nobody tracked .. 1 = audience present (fades between)
		int32 MaxPoints = 500000;
	};

	/** One frame: base points (Unreal space) -> the same points, brighter near Center (floor position of the audience). */
	PHONETWINLINK_API void BuildGlow(const TArray<FLidarPointCloudPoint>& Base, const FGlowParams& P, const FVector3f& Center, double Time, TArray<FLidarPointCloudPoint>& Out);
	/** Brightness 0..1 of a point at floor distance D (no twinkle). */
	PHONETWINLINK_API float GlowBrightness(const FGlowParams& P, float D);

	// ---------------------------------------------------------------- the web's 몰입 보기 (web/immersive.js pointMat), point for point
	/** A wave of gold light from where a collision was touched (Unreal space, cm). Start = world seconds, Amp 1 = first touch, .55 = still touching. */
	struct FTouchWave { FVector3f At = FVector3f::ZeroVector; double Start = -1e9; float Amp = 0; };

	/** Top-down memory of where the audience has been (decays with a half-life), the web's 128² texture. */
	struct FTrailMemory
	{
		static constexpr int32 Size = 128;
		TArray<float> V;                     // Size * Size, 0..1
		FVector2f Min = FVector2f(-300.f), Extent = FVector2f(600.f);   // cm, Unreal XY
		void Reset(const FVector2f& InMin, const FVector2f& InExtent) { Min = InMin; Extent = InExtent; V.Init(0.f, Size * Size); }
		/** Decay by DeltaSeconds and stamp a soft spot of RadiusCm * 0.7 at Center (when bStamp). HalfLife 0 = no memory. */
		PHONETWINLINK_API void Update(float DeltaSeconds, const FVector2f& Center, float RadiusCm, float HalfLife, bool bStamp);
		/** Bilinear sample at an Unreal XY position (0 outside). */
		PHONETWINLINK_API float Sample(float X, float Y) const;
	};

	struct FImmersiveParams
	{
		int32 Mode = 1;               // 0 기억, 1 물결 (touch waves), 2 별빛
		float RadiusCm = 160;         // 드러나는 반경: real colours within, dust beyond
		float ScatterM = .6f;         // 흩어짐: how far the dust drifts (m)
		float Reveal = 1;             // 0 = nobody tracked .. 1 = audience present
		float Gain = 1;               // the web's uGain: dense scans get fainter so they do not pile into a wall
		float FloorZ = 0;             // cm
		float WaveSpeed = 180;        // cm/s
		FTouchWave Waves[4];
		TSharedPtr<const FTrailMemory> Memory;
		int32 MaxPoints = 500000;
	};

	/** One frame of the immersive look: dust that drifts away from the audience, real colours around it, gold touch waves.
	 *  Faint points are kept with a probability that follows their opacity (and drawn brighter), so on the opaque LiDAR
	 *  renderer the dust reads like the web's alpha-blended points instead of black specks hiding the room. */
	PHONETWINLINK_API void BuildImmersive(const TArray<FLidarPointCloudPoint>& Base, const FImmersiveParams& P, const FVector3f& Center, double Time, TArray<FLidarPointCloudPoint>& Out);
	/** Wave strength 0..1+ at a point (the shader's ring + echo, fading over 8 s). */
	PHONETWINLINK_API float WaveAt(const FImmersiveParams& P, const FVector3f& L, double Time);

	// ---------------------------------------------------------------- the same looks on the GPU (PhoneTwinMaterial.cpp)
	/** Material that draws BuildImmersive / BuildGlow in the shader from the static cloud (parameters PT_*, texture PT_Trail).
	 *  The saved asset /Game/PhoneTwinScans/M_PhoneTwinImmersive if present, else (editor) built in memory. Null = CPU fallback. */
	PHONETWINLINK_API UMaterialInterface* GetImmersiveMaterial();
	PHONETWINLINK_API const TCHAR* ImmersiveMaterialPath();
#if WITH_EDITOR
	/** Builds the material graph (one custom HLSL node for the colour, one for the dust drift). */
	PHONETWINLINK_API UMaterial* BuildImmersiveMaterial(UObject* Outer, FName Name, EObjectFlags Flags);
#endif
}
