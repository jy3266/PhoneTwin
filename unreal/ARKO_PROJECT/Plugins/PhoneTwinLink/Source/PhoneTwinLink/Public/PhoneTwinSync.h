// Phone Twin v4 — project settings and the GitHub -> Content/PhoneTwinScans downloader.
#pragma once

#include "CoreMinimal.h"
#include "Engine/DeveloperSettings.h"
#include "PhoneTwinCore.h"
#include "PhoneTwinSync.generated.h"

/** Project Settings > Plugins > Phone Twin */
UCLASS(config = Game, defaultconfig, meta = (DisplayName = "Phone Twin"))
class PHONETWINLINK_API UPhoneTwinSettings : public UDeveloperSettings
{
	GENERATED_BODY()
public:
	UPhoneTwinSettings() { CategoryName = TEXT("Plugins"); }

	/** owner/name of the GitHub repository the phone app uploads to. Public repositories need no token. */
	UPROPERTY(config, EditAnywhere, Category = "GitHub")
	FString Repository = TEXT("jy3266/PhoneTwin");

	UPROPERTY(config, EditAnywhere, Category = "GitHub")
	FString Branch = TEXT("main");

	/** Check GitHub for new scans while the editor is open and download them into Content/PhoneTwinScans. */
	UPROPERTY(config, EditAnywhere, Category = "GitHub")
	bool bAutoSyncInEditor = true;

	UPROPERTY(config, EditAnywhere, Category = "GitHub", meta = (ClampMin = "30"))
	float SyncIntervalSeconds = 90.f;

	/** Only the newest N scans of index.json are downloaded. */
	UPROPERTY(config, EditAnywhere, Category = "GitHub", meta = (ClampMin = "1"))
	int32 MaxScansToDownload = 10;

	/** Also turn every PLY in Content/PhoneTwinScans into a LiDAR Point Cloud asset (/Game/PhoneTwinScans/<id>_Cloud), aligned like the game view. */
	UPROPERTY(config, EditAnywhere, Category = "Editor")
	bool bCreatePointCloudAssets = true;

	/** Spawn a PhoneTwinScanActor automatically when a game/PIE starts and the level has none. */
	UPROPERTY(config, EditAnywhere, Category = "Game")
	bool bAutoSpawnInGame = true;

	static FString ScanDir();
};

/** A scan available on this PC (Content/PhoneTwinScans/<id>.ply [+ <id>.json]). */
struct FPhoneTwinLocalScan { FString Id, PlyPath, MetaPath; FDateTime Time; };

/** Process-wide singleton: one sync at a time, shared by the editor subsystem and the game actor. */
class PHONETWINLINK_API FPhoneTwinSync
{
public:
	static FPhoneTwinSync& Get();

	DECLARE_MULTICAST_DELEGATE_TwoParams(FOnSynced, bool /*bNewFiles*/, const FString& /*Status*/);
	FOnSynced OnSynced;

	/** Starts a sync unless one is running. Game thread. */
	void Run();
	bool IsRunning() const { return bRunning; }
	const FString& GetStatus() const { return Status; }

	/** Scans on disk, newest first. */
	static TArray<FPhoneTwinLocalScan> LocalScans();

private:
	struct FJob { FString RemotePath, LocalPath; };
	void Fetch(const FString& Path, TFunction<void(bool bOk, int32 Code, const TArray<uint8>& Data)> Done, bool bRaw = false);
	void Next();
	void Finish(bool bOk, const FString& Message);

	bool bRunning = false;
	FString Status = TEXT("GitHub 동기화 전");
	FString Repo, Branch;
	TArray<FJob> Jobs;
	int32 Downloaded = 0;
	FString IndexJson;
};
