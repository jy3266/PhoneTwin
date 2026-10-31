// Phone Twin v4 — turns a loaded scan (S frame) into LiDAR point cloud points in Unreal space. Used by the game actor and the editor importer.
#pragma once

#include "CoreMinimal.h"
#include "LidarPointCloudShared.h"
#include "PhoneTwinCore.h"

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
}
