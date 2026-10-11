// Built-in beacon used when an object has no sound assigned: a sine that beeps (on/off) forever.
#pragma once

#include "CoreMinimal.h"
#include "Sound/SoundWaveProcedural.h"
#include "PhoneTwinToneWave.generated.h"

UCLASS()
class PHONETWINLINK_API UPhoneTwinToneWave : public USoundWaveProcedural
{
	GENERATED_BODY()
public:
	UPhoneTwinToneWave(const FObjectInitializer& ObjectInitializer);
	/** Frequency in Hz, beep period in seconds, fraction of the period that sounds. */
	void Configure(float InFrequency, float InPeriod, float InDuty) { Frequency = InFrequency; Period = InPeriod; Duty = InDuty; }
	virtual int32 OnGeneratePCMAudio(TArray<uint8>& OutAudio, int32 NumSamples) override;
private:
	float Frequency = 660.f, Period = .5f, Duty = .3f;
	double Phase = 0; int64 Sample = 0;
	static constexpr int32 Rate = 48000;
};
