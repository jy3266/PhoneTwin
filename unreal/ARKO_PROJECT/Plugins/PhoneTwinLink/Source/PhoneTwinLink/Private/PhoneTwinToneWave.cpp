#include "PhoneTwinToneWave.h"

UPhoneTwinToneWave::UPhoneTwinToneWave(const FObjectInitializer& ObjectInitializer) : Super(ObjectInitializer)
{
	SetSampleRate(Rate);
	NumChannels = 1;
	Duration = INDEFINITELY_LOOPING_DURATION;
	bLooping = true;
	SoundGroup = SOUNDGROUP_Default;
}

int32 UPhoneTwinToneWave::OnGeneratePCMAudio(TArray<uint8>& OutAudio, int32 NumSamples)
{
	OutAudio.SetNumUninitialized(NumSamples * sizeof(int16));
	int16* Out = (int16*)OutAudio.GetData();
	const int64 PeriodSamples = FMath::Max<int64>(1, (int64)(Period * Rate)), On = (int64)(PeriodSamples * Duty), Fade = Rate / 200;   // 5 ms fades
	const double Step = 2.0 * PI * Frequency / Rate;
	for (int32 i = 0; i < NumSamples; i++, Sample++)
	{
		const int64 T = Sample % PeriodSamples;
		const double Env = T >= On ? 0.0 : FMath::Min(1.0, FMath::Min((double)T, (double)(On - T)) / Fade);
		Phase += Step; if (Phase > 2.0 * PI) Phase -= 2.0 * PI;
		Out[i] = (int16)(FMath::Sin(Phase) * Env * 9000.0);
	}
	return NumSamples;
}
