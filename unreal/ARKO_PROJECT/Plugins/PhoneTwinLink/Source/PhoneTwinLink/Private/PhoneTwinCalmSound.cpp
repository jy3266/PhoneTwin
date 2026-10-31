#include "PhoneTwinCalmSound.h"
#include "PhoneTwinCore.h"
#include "Misc/FileHelper.h"

namespace PhoneTwin
{
	// D major pentatonic: degree 0..4 = D E F# A B, octave 3 = D3 (146.8 Hz)
	static float Note(int32 Degree, int32 Octave)
	{
		static const float D3[5] = {146.83f, 164.81f, 185.00f, 220.00f, 246.94f};
		return D3[((Degree % 5) + 5) % 5] * FMath::Pow(2.f, (float)(Octave - 3));
	}

	struct FVoiceDef
	{
		FCalmVoice V;
		FVoiceDef(const TCHAR* Key, const TCHAR* Idea) { V.Key = Key; V.Idea = Idea; }
		FVoiceDef& Pad(float Hz, std::initializer_list<float> R, std::initializer_list<float> A, float Beat, float Swell)
		{
			V.PadHz = Hz; V.Beat = Beat; V.Swell = Swell;
			for (int32 k = 0; k < 4; k++) { V.PadRatio[k] = k < (int32)R.size() ? R.begin()[k] : 0; V.PadAmp[k] = k < (int32)A.size() ? A.begin()[k] : 0; }
			return *this;
		}
		FVoiceDef& AirNoise(float Amount, float Hz) { V.Air = Amount; V.AirHz = Hz; return *this; }
		FVoiceDef& Rain(float PerSecond) { V.Drops = PerSecond; return *this; }
		FVoiceDef& Bell(float Hz, std::initializer_list<float> R, std::initializer_list<float> A, std::initializer_list<float> Decay, float Attack = .008f)
		{
			V.BellHz = Hz; V.Attack = Attack;
			for (int32 k = 0; k < 4; k++)
			{
				V.BellRatio[k] = k < (int32)R.size() ? R.begin()[k] : 0; V.BellAmp[k] = k < (int32)A.size() ? A.begin()[k] : 0;
				V.BellDecay[k] = k < (int32)Decay.size() ? Decay.begin()[k] : 1;
			}
			return *this;
		}
	};

	// modal ratios: singing bowl, glass, wooden bar, kalimba tine, string, gong
	#define PT_BOWL {1.f, 2.71f, 5.15f}
	#define PT_GLASS {1.f, 2.32f, 4.25f, 6.63f}
	#define PT_WOOD {1.f, 3.93f, 9.24f}
	#define PT_TINE {1.f, 5.4f, 13.1f}
	#define PT_STRING {1.f, 2.f, 3.f, 4.f}
	#define PT_GONG {1.f, 1.47f, 2.09f, 2.56f}

	FCalmVoice CalmVoiceFor(const FString& LabelIn)
	{
		const FString L = LabelIn.ToLower().TrimStartAndEnd();
		auto Is = [&L](std::initializer_list<const TCHAR*> Keys) { for (const TCHAR* K : Keys) if (L == K) return true; return false; };

		if (Is({TEXT("cup"), TEXT("vase"), TEXT("bowl")}))
			return FVoiceDef(TEXT("cup"), TEXT("찻잔·그릇 → 싱잉볼처럼 낮게 울리는 허밍 · 닿으면 도자기 종"))
				.Pad(Note(3, 2), {1, 2, 2.76f}, {1, .3f, .18f}, .35f, .07f).AirNoise(.04f, 900)
				.Bell(Note(3, 5), {1, 2.76f, 5.4f, 8.93f}, {1, .45f, .2f, .08f}, {4, 1.8f, .8f, .35f}).V;
		if (Is({TEXT("bottle"), TEXT("wine glass")}))
			return FVoiceDef(TEXT("bottle"), TEXT("유리병 → 병 입구를 부는 숨결 · 닿으면 유리 풍경"))
				.Pad(Note(0, 3), {1, 2, 3}, {.55f, .15f, .05f}, .2f, .11f).AirNoise(.5f, 1500)
				.Bell(Note(0, 5), PT_GLASS, {1, .5f, .25f, .1f}, {3.5f, 1.4f, .6f, .3f}).V;
		if (Is({TEXT("keyboard")}))
			return FVoiceDef(TEXT("keyboard"), TEXT("키보드 → 타자 소리를 닮은 잔잔한 빗방울 · 닿으면 나무 마림바"))
				.Pad(Note(1, 2), {1, 1.5f, 2, 3}, {.7f, .3f, .25f, .08f}, .25f, .06f).AirNoise(.2f, 600).Rain(3)
				.Bell(Note(1, 4), PT_WOOD, {1, .22f, .05f}, {1.6f, .4f, .12f}, .004f).V;
		if (Is({TEXT("mouse")}))
			return FVoiceDef(TEXT("mouse"), TEXT("마우스 → 작은 클릭이 물방울로 · 닿으면 칼림바"))
				.Pad(Note(2, 3), {1, 2}, {.5f, .15f}, .3f, .09f).AirNoise(.08f, 900).Rain(1.2f)
				.Bell(Note(2, 4), PT_TINE, {1, .18f, .05f}, {2, .4f, .15f}).V;
		if (Is({TEXT("tv"), TEXT("monitor")}))
			return FVoiceDef(TEXT("tv"), TEXT("TV → 화면의 웅웅거림을 따뜻한 전자 패드로 · 닿으면 전자 피아노"))
				.Pad(Note(4, 2), {1, 2, 3, 4}, {1, .4f, .22f, .1f}, .5f, .05f).AirNoise(.03f, 3000)
				.Bell(Note(4, 4), {1, 2, 3, 4.01f}, {1, .35f, .12f, .05f}, {2.8f, 1.3f, .6f, .3f}).V;
		if (Is({TEXT("laptop")}))
			return FVoiceDef(TEXT("laptop"), TEXT("노트북 → 팬 바람과 화면 빛 · 닿으면 맑은 전자 종"))
				.Pad(Note(3, 2), {1, 2, 4}, {.9f, .35f, .12f}, .3f, .06f).AirNoise(.12f, 1800)
				.Bell(Note(3, 4), {1, 2, 3, 4.2f}, {1, .3f, .1f, .05f}, {2.5f, 1.2f, .5f, .25f}).V;
		if (Is({TEXT("remote"), TEXT("cell phone")}))
			return FVoiceDef(TEXT("remote"), TEXT("리모컨·휴대폰 → 작은 신호음을 부드러운 사인파로 · 닿으면 유리 방울"))
				.Pad(Note(4, 3), {1, 2}, {.4f, .1f}, .4f, .1f)
				.Bell(Note(4, 4), {1, 5.4f}, {1, .15f}, {1.5f, .3f}).V;
		if (Is({TEXT("book")}))
			return FVoiceDef(TEXT("book"), TEXT("책 → 종이를 넘기는 바람결 · 닿으면 하프"))
				.Pad(Note(0, 2), {1, 2, 3}, {.7f, .25f, .1f}, .2f, .07f).AirNoise(.45f, 450)
				.Bell(Note(0, 4), PT_STRING, {1, .5f, .25f, .12f}, {2.4f, 1.5f, .9f, .5f}, .003f).V;
		if (Is({TEXT("backpack"), TEXT("handbag"), TEXT("suitcase"), TEXT("teddy bear")}))
			return FVoiceDef(TEXT("backpack"), TEXT("가방·천 → 천이 스치는 부드러운 바람 · 닿으면 낮은 현"))
				.Pad(Note(1, 2), {1, 2}, {.6f, .2f}, .2f, .09f).AirNoise(.5f, 350)
				.Bell(Note(1, 3), PT_STRING, {1, .45f, .2f, .1f}, {2.2f, 1.4f, .8f, .4f}, .004f).V;
		if (Is({TEXT("chair"), TEXT("bench"), TEXT("dining table"), TEXT("desk")}))
			return FVoiceDef(TEXT("chair"), TEXT("의자·탁자 → 나무의 낮은 울림(첼로 같은 드론) · 닿으면 나무 마림바"))
				.Pad(Note(0, 2), {1, 2, 3, 4}, {1, .5f, .28f, .12f}, .22f, .05f).AirNoise(.05f, 500)
				.Bell(Note(0, 3), PT_WOOD, {1, .25f, .06f}, {2, .5f, .15f}, .004f).V;
		if (Is({TEXT("potted plant")}))
			return FVoiceDef(TEXT("potted plant"), TEXT("화분 → 잎을 흔드는 바람 · 닿으면 칼림바"))
				.Pad(Note(3, 2), {1, 1.5f, 2}, {.5f, .2f, .2f}, .3f, .1f).AirNoise(.4f, 2200)
				.Bell(Note(3, 4), PT_TINE, {1, .2f, .06f}, {2.4f, .5f, .2f}).V;
		if (Is({TEXT("bed"), TEXT("couch")}))
			return FVoiceDef(TEXT("bed"), TEXT("침대·소파 → 잠든 숨결처럼 천천히 부풀었다 가라앉는 소리 · 닿으면 낮은 징"))
				.Pad(Note(0, 2), {1, 2, 3}, {.8f, .25f, .08f}, .15f, .1f).AirNoise(.35f, 400)
				.Bell(Note(0, 3), PT_GONG, {1, .5f, .3f, .2f}, {6, 4, 2.5f, 1.5f}, .02f).V;
		if (Is({TEXT("clock")}))
			return FVoiceDef(TEXT("clock"), TEXT("시계 → 째깍임을 느린 물방울로 · 닿으면 작은 종"))
				.Pad(Note(2, 2), {1, 2}, {.6f, .2f}, .25f, .06f).Rain(1)
				.Bell(Note(2, 5), PT_BOWL, {1, .35f, .12f}, {3, 1.4f, .6f}).V;
		if (Is({TEXT("sink"), TEXT("toilet")}))
			return FVoiceDef(TEXT("sink"), TEXT("물가 → 고요한 물결과 물방울 · 닿으면 맑은 종"))
				.Pad(Note(0, 3), {1, 1.5f}, {.45f, .15f}, .2f, .08f).AirNoise(.3f, 700).Rain(2)
				.Bell(Note(0, 5), PT_BOWL, {1, .35f, .12f}, {3.5f, 1.6f, .7f}).V;
		if (L == TEXT("surface"))
			return FVoiceDef(TEXT("surface"), TEXT("벽·바닥 → 공간의 잔잔한 물결 · 닿으면 싱잉볼"))
				.Pad(Note(0, 3), {1, 1.5f, 2}, {.5f, .2f, .15f}, .2f, .06f).AirNoise(.25f, 700)
				.Bell(Note(0, 4), PT_BOWL, {1, .35f, .12f}, {5, 2.5f, 1}).V;

		// anything else: a singing bowl on a note picked from the label, so each kind keeps its own pitch
		const int32 Deg = (int32)(GetTypeHash(L) % 5);
		return FVoiceDef(*L, TEXT("사물 → 싱잉볼 허밍 · 닿으면 싱잉볼 종"))
			.Pad(Note(Deg, 2), {1, 2, 2.71f}, {.8f, .3f, .15f}, .3f, .07f).AirNoise(.1f, 800)
			.Bell(Note(Deg, 4), PT_BOWL, {1, .4f, .15f}, {4, 2, .8f}).V;
	}

	void FCalmSynth::Init(const FCalmVoice& V, int32 InRate)
	{
		Rate = InRate;
		const double TwoPi = 2.0 * PI;
		float Sum = 0; for (int32 k = 0; k < 4; k++) if (V.PadRatio[k] > 0) Sum += V.PadAmp[k];
		NumPad = 0;
		for (int32 k = 0; k < 4; k++)
		{
			if (V.PadRatio[k] <= 0) continue;
			const double F = V.PadHz * V.PadRatio[k];
			for (int32 c = 0; c < 2; c++)   // two copies a few tenths of a Hz apart: slow, gentle beating
			{
				PadStep[NumPad] = TwoPi * (F + c * V.Beat * (1 + .3 * k)) / Rate;
				PadPhase[NumPad] = c * 1.3 + k * .7;
				PadGain[NumPad] = V.PadAmp[k] / FMath::Max(Sum, 1e-3f) * .5f;
				NumPad++;
			}
		}
		float BellSum = 0; for (int32 k = 0; k < 4; k++) if (V.BellRatio[k] > 0) BellSum += V.BellAmp[k];
		for (int32 k = 0; k < 4; k++)
		{
			BellStep[k] = TwoPi * V.BellHz * V.BellRatio[k] / Rate;
			BellBase[k] = V.BellRatio[k] > 0 ? V.BellAmp[k] / FMath::Max(BellSum, 1e-3f) : 0;
			BellMul[k] = FMath::Exp(-6.9078f / (FMath::Max(.05f, V.BellDecay[k]) * Rate));
			BellGain[k] = 0; BellPhase[k] = 0;
		}
		EnvCoef = 1.f - FMath::Exp(-1.f / (.8f * Rate));
		SwellStep = TwoPi * V.Swell / Rate;
		Air = V.Air; AirCoef = 1.f - FMath::Exp(-2.f * PI * V.AirHz / Rate);
		DropProb = V.Drops / Rate; DropMul = FMath::Exp(-6.9078f / (.25f * Rate)); DropBaseHz = V.PadHz * 8;
		AttackStep = 1.f / FMath::Max(1.f, V.Attack * Rate); Attack = 1;
		Rng = 22222u + GetTypeHash(V.Key);
		static const int32 CombLen[4] = {1116, 1188, 1277, 1356}, ApLen[2] = {556, 441};
		for (int32 k = 0; k < 4; k++) { Comb[k].Init(0.f, CombLen[k] * Rate / 44100); CombPos[k] = 0; CombLp[k] = 0; }
		for (int32 k = 0; k < 2; k++) { Allpass[k].Init(0.f, ApLen[k] * Rate / 44100); AllpassPos[k] = 0; }
	}

	void FCalmSynth::Touch(float Strength01)
	{
		// the new energy fades in over Attack, so a strike never clicks and never cuts the ring that is still sounding
		Pending = FMath::Clamp(Strength01, 0.f, 1.f); Attack = 0;
	}

	float FCalmSynth::Reverb(float In)
	{
		// mono Freeverb (4 combs + 2 all-passes): a soft room around every voice
		float Out = 0; const float X = In * .03f;
		for (int32 k = 0; k < 4; k++)
		{
			float& B = Comb[k][CombPos[k]];
			const float Y = B; CombLp[k] = Y * .75f + CombLp[k] * .25f;
			B = X + CombLp[k] * .84f; Out += Y;
			if (++CombPos[k] >= Comb[k].Num()) CombPos[k] = 0;
		}
		for (int32 k = 0; k < 2; k++)
		{
			float& B = Allpass[k][AllpassPos[k]];
			const float Y = B - Out; B = Out + B * .5f; Out = Y;
			if (++AllpassPos[k] >= Allpass[k].Num()) AllpassPos[k] = 0;
		}
		return Out;
	}

	void FCalmSynth::Render(float* Out, int32 Num)
	{
		static const float Penta[6] = {1.f, 1.125f, 1.25f, 1.5f, 1.6667f, 2.f};
		const double TwoPi = 2.0 * PI;
		float Peak = 0;
		for (int32 i = 0; i < Num; i++)
		{
			Env += (NearTarget - Env) * EnvCoef;
			SwellPhase += SwellStep; if (SwellPhase > TwoPi) SwellPhase -= TwoPi;
			const float Sw = .75f + .25f * FMath::Sin((float)SwellPhase);
			float Pad = 0, A = 0, Drop = 0, Bell = 0;
			if (Env > 1e-4f)
			{
				for (int32 k = 0; k < NumPad; k++)
				{
					Pad += FMath::Sin((float)PadPhase[k]) * PadGain[k];
					PadPhase[k] += PadStep[k]; if (PadPhase[k] > TwoPi) PadPhase[k] -= TwoPi;
				}
				Pad *= Env * Sw * .3f;
				if (Air > 0)
				{
					Lp1 += AirCoef * (Noise() - Lp1); Lp2 += AirCoef * (Lp1 - Lp2);
					A = Lp2 * Air * Env * Sw * .35f / FMath::Sqrt(AirCoef);
				}
				if (DropProb > 0 && Env > .02f && Noise() * .5f + .5f < DropProb)
				{
					DropGain = .1f * (.4f + .6f * (Noise() * .5f + .5f)) * Env;
					DropStep = TwoPi * DropBaseHz * Penta[FMath::Min(5, (int32)((Noise() * .5f + .5f) * 6))] / Rate; DropPhase = 0;
				}
			}
			if (DropGain > 1e-5f)
			{
				Drop = FMath::Sin((float)DropPhase) * DropGain; DropPhase += DropStep; DropGain *= DropMul;
			}
			if (Attack < 1.f)
			{
				for (int32 k = 0; k < 4; k++) BellGain[k] = FMath::Min(BellGain[k] + BellBase[k] * Pending * AttackStep, BellBase[k] * 1.5f);
				Attack += AttackStep;
			}
			for (int32 k = 0; k < 4; k++)
			{
				if (BellGain[k] < 1e-5f) continue;
				Bell += FMath::Sin((float)BellPhase[k]) * BellGain[k];
				BellPhase[k] += BellStep[k]; if (BellPhase[k] > TwoPi) BellPhase[k] -= TwoPi;
				BellGain[k] *= BellMul[k];
			}
			Bell *= .32f;
			const float Dry = Pad + A + Drop + Bell;
			const float Y = FMath::Clamp(Dry * .85f + Reverb(Dry) * .5f, -3.f, 3.f);
			Out[i] = Y * (27.f + Y * Y) / (27.f + 9.f * Y * Y);   // soft clip
			Peak = FMath::Max(Peak, FMath::Abs(Out[i]));
		}
		LastPeak = Peak;
	}
}

UPhoneTwinCalmWave::UPhoneTwinCalmWave(const FObjectInitializer& ObjectInitializer) : Super(ObjectInitializer)
{
	SetSampleRate(Rate);
	NumChannels = 1;
	Duration = INDEFINITELY_LOOPING_DURATION;
	bLooping = true;
	SoundGroup = SOUNDGROUP_Default;
}

void UPhoneTwinCalmWave::Configure(const PhoneTwin::FCalmVoice& Voice)
{
	Synth.Init(Voice, Rate);
	Idea = Voice.Idea;
}

int32 UPhoneTwinCalmWave::OnGeneratePCMAudio(TArray<uint8>& OutAudio, int32 NumSamples)
{
	Synth.SetNear(Near.load());
	const int32 C = TouchCount.load();
	if (C != SeenTouch) { SeenTouch = C; Synth.Touch(TouchStrength.load()); }
	Buf.SetNumUninitialized(NumSamples);
	Synth.Render(Buf.GetData(), NumSamples);
	OutAudio.SetNumUninitialized(NumSamples * sizeof(int16));
	int16* Out = (int16*)OutAudio.GetData();
	for (int32 i = 0; i < NumSamples; i++) Out[i] = (int16)(Buf[i] * 20000.f);
	return NumSamples;
}

UPhoneTwinFileWave::UPhoneTwinFileWave(const FObjectInitializer& ObjectInitializer) : Super(ObjectInitializer)
{
	Duration = INDEFINITELY_LOOPING_DURATION;
	bLooping = true;
	SoundGroup = SOUNDGROUP_Default;
}

bool UPhoneTwinFileWave::LoadFile(const FString& Path, bool bLoop, FString& OutError)
{
	TArray<uint8> Bytes;
	if (!FFileHelper::LoadFileToArray(Bytes, *Path)) { OutError = TEXT("파일 없음"); return false; }
	int32 Rate = 48000, Channels = 2;
	if (!PhoneTwin::ParseWav(Bytes, Pcm, Rate, Channels, OutError)) return false;
	SetSampleRate(Rate);
	NumChannels = Channels;
	bLoopFile = bLoop;
	Cursor = bLoop ? 0 : Pcm.Num();   // a one-shot stays silent until Restart()
	return true;
}

int32 UPhoneTwinFileWave::OnGeneratePCMAudio(TArray<uint8>& OutAudio, int32 NumSamples)
{
	const int32 R = RestartCount.load();
	if (R != SeenRestart) { SeenRestart = R; Cursor = 0; }
	OutAudio.SetNumUninitialized(NumSamples * sizeof(int16));
	int16* Out = (int16*)OutAudio.GetData();
	const int64 Len = Pcm.Num();
	for (int32 i = 0; i < NumSamples; i++)
	{
		if (Cursor >= Len) { if (bLoopFile && Len > 0) Cursor = 0; else { Out[i] = 0; continue; } }
		Out[i] = Pcm[Cursor++];
	}
	return NumSamples;
}
