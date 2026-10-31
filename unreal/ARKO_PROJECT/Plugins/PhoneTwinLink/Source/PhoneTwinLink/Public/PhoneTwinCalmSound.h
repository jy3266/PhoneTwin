// Phone Twin v4 — calm built-in sounds, one voice per kind of AI-recognised object
// (a cup hums like a singing bowl, a keyboard patters like soft rain, a book breathes like turning paper …).
// Two layers per object: a soft pad that swells while the audience comes closer, and a chime that rings once on touch.
// Every note comes from D major pentatonic, so several objects sounding together never clash.
#pragma once

#include "CoreMinimal.h"
#include "Sound/SoundWaveProcedural.h"
#include <atomic>
#include "PhoneTwinCalmSound.generated.h"

namespace PhoneTwin
{
	/** Sound design of one kind of object. */
	struct FCalmVoice
	{
		FString Key;               // AI label this voice is for ("cup"), "surface" for walls/floor
		FString Idea;              // what it is inspired by, shown on the HUD
		float PadHz = 110.f;       // approach pad: fundamental
		float PadRatio[4] = {1, 2, 0, 0};
		float PadAmp[4] = {1, .3f, 0, 0};
		float Beat = .3f;          // Hz between two detuned copies: slow shimmer
		float Swell = .08f;        // breathing of the pad, Hz
		float Air = 0;             // filtered noise: breath, wind, paper
		float AirHz = 800.f;       // its low-pass cutoff
		float Drops = 0;           // soft droplets per second (keyboard -> rain), 0 = none
		float BellHz = 440.f;      // touch chime: fundamental
		float BellRatio[4] = {1, 2.76f, 5.4f, 0};
		float BellAmp[4] = {1, .4f, .15f, 0};
		float BellDecay[4] = {3, 1.5f, .6f, 1};   // seconds to -60 dB
		float Attack = .008f;      // chime attack, seconds (no clicks)
	};

	/** Voice for an AI label ("cup", "potted plant" …). Unknown labels get a singing-bowl voice on a note picked from the label. */
	PHONETWINLINK_API FCalmVoice CalmVoiceFor(const FString& Label);

	/** Mono synthesizer for one voice; Render() runs on the audio thread. */
	class PHONETWINLINK_API FCalmSynth
	{
	public:
		void Init(const FCalmVoice& V, int32 InRate);
		/** Target loudness of the approach pad, 0..1 (glides over ~0.8 s). */
		void SetNear(float Target01) { NearTarget = FMath::Clamp(Target01, 0.f, 1.f); }
		/** Ring the touch chime. */
		void Touch(float Strength01);
		void Render(float* Out, int32 Num);
		/** Peak of the last Render() block. */
		float Peak() const { return LastPeak; }
	private:
		float Noise() { Rng = Rng * 1664525u + 1013904223u; return (float)(Rng >> 8) / 8388608.f - 1.f; }
		float Reverb(float In);
		int32 Rate = 48000, NumPad = 0;
		double PadPhase[8] = {}, PadStep[8] = {}; float PadGain[8] = {};
		double BellPhase[4] = {}, BellStep[4] = {}; float BellGain[4] = {}, BellBase[4] = {}, BellMul[4] = {};
		double SwellPhase = 0, SwellStep = 0, DropPhase = 0, DropStep = 0;
		float NearTarget = 0, Env = 0, EnvCoef = 0, Air = 0, AirCoef = 0, Lp1 = 0, Lp2 = 0;
		float DropProb = 0, DropGain = 0, DropMul = 0, DropBaseHz = 0;
		float Attack = 1, AttackStep = 1, Pending = 0, LastPeak = 0;
		uint32 Rng = 22222;
		TArray<float> Comb[4], Allpass[2]; int32 CombPos[4] = {}, AllpassPos[2] = {}; float CombLp[4] = {};
	};
}

/** Procedural sound wave playing one FCalmSynth. SetNear / Touch are called from the game thread. */
UCLASS()
class PHONETWINLINK_API UPhoneTwinCalmWave : public USoundWaveProcedural
{
	GENERATED_BODY()
public:
	UPhoneTwinCalmWave(const FObjectInitializer& ObjectInitializer);
	void Configure(const PhoneTwin::FCalmVoice& Voice);
	void SetNear(float Target01) { Near.store(Target01); }
	void Touch(float Strength01) { TouchStrength.store(Strength01); TouchCount.fetch_add(1); }
	virtual int32 OnGeneratePCMAudio(TArray<uint8>& OutAudio, int32 NumSamples) override;
	FString Idea;
private:
	PhoneTwin::FCalmSynth Synth;
	TArray<float> Buf;
	std::atomic<float> Near{0.f}, TouchStrength{1.f};
	std::atomic<int32> TouchCount{0};
	int32 SeenTouch = 0;
	static constexpr int32 Rate = 48000;
};

/** A user's WAV played from memory: loops for the approach layer, plays once per Restart() for the touch layer. */
UCLASS()
class PHONETWINLINK_API UPhoneTwinFileWave : public USoundWaveProcedural
{
	GENERATED_BODY()
public:
	UPhoneTwinFileWave(const FObjectInitializer& ObjectInitializer);
	bool LoadFile(const FString& Path, bool bLoop, FString& OutError);
	void Restart() { RestartCount.fetch_add(1); }
	virtual int32 OnGeneratePCMAudio(TArray<uint8>& OutAudio, int32 NumSamples) override;
private:
	TArray<int16> Pcm;      // not changed after LoadFile, read on the audio thread
	bool bLoopFile = true;
	int64 Cursor = 0;
	std::atomic<int32> RestartCount{0};
	int32 SeenRestart = 0;
};
