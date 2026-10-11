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
}
