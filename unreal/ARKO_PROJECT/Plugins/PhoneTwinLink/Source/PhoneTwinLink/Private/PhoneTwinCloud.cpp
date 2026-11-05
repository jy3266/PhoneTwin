#include "PhoneTwinCloud.h"
#include "Async/ParallelFor.h"

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

	// ---------------------------------------------------------------- immersive look (same numbers as web/immersive.js)
	static float Smooth(float E0, float E1, float X)
	{
		const float T = FMath::Clamp((X - E0) / (E1 - E0), 0.f, 1.f);
		return T * T * (3.f - 2.f * T);
	}

	void FTrailMemory::Update(float DeltaSeconds, const FVector2f& Center, float RadiusCm, float HalfLife, bool bStamp)
	{
		if (V.Num() != Size * Size) V.Init(0.f, Size * Size);
		const float Decay = HalfLife > 0 ? FMath::Pow(.5f, DeltaSeconds / HalfLife) : 0.f;
		const float Cx = (Center.X - Min.X) / Extent.X * Size, Cy = (Center.Y - Min.Y) / Extent.Y * Size;
		const float Rc = RadiusCm * .7f / Extent.X * Size, R2 = FMath::Max(1e-4f, Rc * Rc);
		for (int32 j = 0; j < Size; j++)
			for (int32 i = 0; i < Size; i++)
			{
				float& W = V[j * Size + i];
				W *= Decay;
				if (bStamp && HalfLife > 0)
				{
					const float Dx = i + .5f - Cx, Dy = j + .5f - Cy, Q = (Dx * Dx + Dy * Dy) / R2;
					if (Q < 4) W = FMath::Max(W, FMath::Exp(-Q * 1.5f));
				}
			}
	}

	float FTrailMemory::Sample(float X, float Y) const
	{
		if (V.Num() != Size * Size) return 0;
		const float U = (X - Min.X) / Extent.X * Size - .5f, W = (Y - Min.Y) / Extent.Y * Size - .5f;
		const int32 I = FMath::FloorToInt(U), J = FMath::FloorToInt(W);
		const float Fu = U - I, Fw = W - J;
		auto At = [this](int32 a, int32 b) { a = FMath::Clamp(a, 0, Size - 1); b = FMath::Clamp(b, 0, Size - 1); return V[b * Size + a]; };   // clamp to edge like the texture
		return FMath::Lerp(FMath::Lerp(At(I, J), At(I + 1, J), Fu), FMath::Lerp(At(I, J + 1), At(I + 1, J + 1), Fu), Fw);
	}

	float WaveAt(const FImmersiveParams& P, const FVector3f& L, double Time)
	{
		float Wave = 0;
		for (const FTouchWave& W : P.Waves)
		{
			const float Age = (float)(Time - W.Start);
			if (Age < 0 || Age > 8.f || W.Amp <= 0) continue;
			const float Dw = FVector3f::Dist(L, W.At) / 100.f, Wr = Age * P.WaveSpeed / 100.f;   // metres, like the shader
			const float Ring = FMath::Exp(-FMath::Square((Dw - Wr) * 4.5f)) + .35f * FMath::Exp(-FMath::Square((Dw - Wr * .6f) * 7.f));   // a thin main wave and a softer echo
			Wave = FMath::Max(Wave, Ring * FMath::Exp(-Age * .45f) * W.Amp);
		}
		return Wave;
	}

	void BuildImmersive(const TArray<FLidarPointCloudPoint>& Base, const FImmersiveParams& P, const FVector3f& Center, double Time, TArray<FLidarPointCloudPoint>& Out)
	{
		const int32 N = Base.Num();
		Out.Reset(FMath::Min(N, P.MaxPoints));
		const float Budget = FMath::Min(1.f, (float)P.MaxPoints / FMath::Max(1, N));
		const float T = (float)FMath::Fmod(Time, 10000.0);
		const float R = FMath::Max(.05f, P.RadiusCm / 100.f), Reveal = FMath::Clamp(P.Reveal, 0.f, 1.f);
		const float MemK = P.Mode == 2 ? .9f : .7f, FarA0 = P.Mode == 2 ? .30f : .10f;
		const float FloorM = P.FloorZ / 100.f;
		const bool bWaves = P.Mode == 1;
		const FTrailMemory* Mem = P.Memory.Get();
		const FLinearColor Ghost(.45f, .62f, 1.f), Gold(1.f, .78f, .4f);
		// every point is independent: split into chunks over the worker threads, then join them in order (same result every time)
		const int32 Chunks = FMath::Clamp(N / 20000, 1, 32);
		TArray<TArray<FLidarPointCloudPoint>> Parts; Parts.SetNum(Chunks);
		ParallelFor(Chunks, [&](int32 Chunk)
		{
		TArray<FLidarPointCloudPoint>& Part = Parts[Chunk];
		const int32 I0 = (int64)N * Chunk / Chunks, I1 = (int64)N * (Chunk + 1) / Chunks;
		Part.Reserve(I1 - I0);
		for (int32 i = I0; i < I1; i++)
		{
			const uint32 H = Hash((uint32)i * 2654435761u + 12345u);
			const float S2 = (H >> 16) / 65536.f, Rnd = (H & 0xffff) / 65536.f;
			if (S2 >= Budget) continue;   // very large scans are thinned evenly
			const FLidarPointCloudPoint& B = Base[i];
			const FVector3f& L = B.Location;
			// web axes: x = X, y (up) = Z, z = Y, all in metres
			const float Px = L.X / 100.f, Py = L.Z / 100.f, Pz = L.Y / 100.f;
			const float D = FMath::Sqrt(FMath::Square(L.X - Center.X) + FMath::Square(L.Y - Center.Y)) / 100.f;
			const float Near = (1.f - Smooth(R * .45f, R, D)) * Reveal;
			const float M = Mem ? Mem->Sample(L.X, L.Y) : 0.f;
			float Lit = FMath::Max(Near, M * MemK);
			float Wave = 0;
			if (bWaves) { Wave = WaveAt(P, L, Time); Lit = FMath::Max(Lit, Wave * .8f); }
			Lit = FMath::Min(Lit, 1.f);
			const float Far = 1.f - Lit;

			// alpha first (the web blends; here faint points are kept with that probability and drawn brighter)
			const float Tw = .65f + .35f * FMath::Sin(T * (1.2f + Rnd * 3.f) + Rnd * 50.f);
			const float FarA = FarA0 * Tw * (1.f - Smooth(R, R * 5.f, D) * .6f);
			const float A = FMath::Clamp(FMath::Lerp(FarA, 1.f, Lit) * P.Gain, 0.f, 1.f);
			// opaque points here: dropping faint ones would make the octree draw the rest as big blobs, so every point stays and
			// its brightness carries the opacity (x2.5 for the many faint points the web stacks on each pixel)
			const float Shown = FMath::Min(1.f, A * 2.5f);

			// far points drift like dust and rise slowly; the closer the audience, the more they settle back into the room
			const float Td = T * .18f + Rnd * 6.2832f;
			const float Dx = FMath::Sin(Td * 1.3f + Py * 2.1f + Pz), Dz = FMath::Cos(Td * 1.1f + Px * 1.9f - Py);
			const float Dy = FMath::Sin(Td * .7f + Px * 1.3f) * .5f + (Rnd - .25f) * .9f + (Py - FloorM) * .15f;
			const float Amt = P.ScatterM * Far * Far * (.3f + .7f * Rnd) * 100.f;   // cm

			const FLinearColor C0(B.Color);   // sRGB bytes -> linear, as three.js' PLYLoader does
			const float Grey = C0.R * .299f + C0.G * .587f + C0.B * .114f;
			FLinearColor C = FMath::Lerp(Ghost * (.35f + Grey), C0 * 1.1f, Lit) + Gold * (Wave * .45f);
			// the web draws lit and wave points larger (0.6 .. 1 x, up to 1.9 x in a wave); one point size here, so brightness carries it
			const float SizeK = FMath::Lerp(.6f, 1.f, Lit) * (1.f + Wave * .9f);
			// the web's far dust is a haze of many faint blended points; one opaque point per pixel here, so dim it further
			const float Haze = FMath::Lerp(.6f, 1.f, Lit);
			C = C * (Shown * SizeK * Haze);
			C.A = 1;

			FLidarPointCloudPoint Q = B;
			Q.Location = L + FVector3f(Dx, Dz, Dy) * Amt;
			Q.Color = C.ToFColor(true);
			Q.Color.A = 255;
			Part.Add(Q);
		}
		});
		for (TArray<FLidarPointCloudPoint>& Part : Parts) Out.Append(MoveTemp(Part));
	}
}
