#include "PhoneTwinCloud.h"

namespace PhoneTwin
{
	static uint32 Hash(uint32 X)
	{
		X ^= X >> 16; X *= 0x7feb352du; X ^= X >> 15; X *= 0x846ca68bu; X ^= X >> 16;
		return X;
	}

	static float Nearness(const FGlowParams& P, float D)
	{
		const float Far = FMath::Max(P.FadeRadius, P.LitRadius + 1.f);
		const float T = FMath::Clamp((D - P.LitRadius) / (Far - P.LitRadius), 0.f, 1.f);
		return FMath::Clamp(P.Reveal, 0.f, 1.f) * (1.f - T * T * (3.f - 2.f * T));   // smoothstep: 1 at the audience .. 0 far away
	}

	float GlowBrightness(const FGlowParams& P, float D)
	{
		const float Dim = FMath::Lerp(P.IdleBrightness, P.FarBrightness, FMath::Clamp(P.Reveal, 0.f, 1.f));
		return FMath::Lerp(Dim, P.NearBrightness, Nearness(P, D));
	}

	void BuildGlow(const TArray<FLidarPointCloudPoint>& Base, const FGlowParams& P, const FVector3f& Center, double Time, TArray<FLidarPointCloudPoint>& Out)
	{
		const int32 N = Base.Num();
		Out.Reset(FMath::Min(N, P.MaxPoints));
		const float Budget = FMath::Min(1.f, (float)P.MaxPoints / FMath::Max(1, N));
		const float T = (float)FMath::Fmod(Time, 10000.0);
		const float Dim = FMath::Lerp(P.IdleBrightness, P.FarBrightness, FMath::Clamp(P.Reveal, 0.f, 1.f));
		for (int32 i = 0; i < N; i++)
		{
			const uint32 H = Hash((uint32)i * 2654435761u + 12345u);
			const float S1 = (H & 0xffff) / 65536.f, S2 = (H >> 16) / 65536.f;
			if (S2 >= Budget) continue;   // very large scans are thinned evenly
			const FLidarPointCloudPoint& B = Base[i];
			const FVector3f& L = B.Location;
			const float Near = Nearness(P, FMath::Sqrt(FMath::Square(L.X - Center.X) + FMath::Square(L.Y - Center.Y)));
			// dim points breathe a little, each at its own pace, like faint lights
			const float Tw = 1.f - P.Twinkle * (1.f - Near) * (.5f + .5f * FMath::Sin(T * (.8f + 1.4f * S1) + S2 * 6.283f));
			const float Bright = FMath::Lerp(Dim, P.NearBrightness, Near) * Tw;
			const FLinearColor C0(B.Color);
			const FLinearColor C = FMath::Lerp(C0, FLinearColor::White, P.NearWhite * Near) * Bright;
			FLidarPointCloudPoint Q = B;
			Q.Color = C.ToFColor(true);
			Q.Color.A = 255;
			Out.Add(Q);
		}
	}
}
