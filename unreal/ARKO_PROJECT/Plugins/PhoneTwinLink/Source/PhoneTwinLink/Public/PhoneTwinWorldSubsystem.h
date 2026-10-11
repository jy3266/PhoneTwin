// Auto-spawns the Phone Twin actor so pressing Play is enough.
#pragma once

#include "CoreMinimal.h"
#include "Subsystems/WorldSubsystem.h"
#include "EngineUtils.h"
#include "PhoneTwinScanActor.h"
#include "PhoneTwinSync.h"
#include "PhoneTwinWorldSubsystem.generated.h"

/** Puts a PhoneTwinScanActor into every game/PIE world that has none, so pressing Play is enough. */
UCLASS()
class UPhoneTwinWorldSubsystem : public UWorldSubsystem
{
	GENERATED_BODY()
public:
	virtual bool DoesSupportWorldType(const EWorldType::Type T) const override { return T == EWorldType::Game || T == EWorldType::PIE; }
	virtual void OnWorldBeginPlay(UWorld& World) override
	{
		Super::OnWorldBeginPlay(World);
		if (!GetDefault<UPhoneTwinSettings>()->bAutoSpawnInGame) return;
		for (TActorIterator<APhoneTwinScanActor> It(&World); It; ++It) return;
		FActorSpawnParameters P; P.Name = TEXT("PhoneTwinScan_Auto");
		World.SpawnActor<APhoneTwinScanActor>(FVector::ZeroVector, FRotator::ZeroRotator, P);
	}
};
