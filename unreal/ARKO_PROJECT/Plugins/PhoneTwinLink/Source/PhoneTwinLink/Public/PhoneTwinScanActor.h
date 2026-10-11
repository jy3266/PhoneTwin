// Phone Twin v4 — the scanned space inside Unreal.
//  * shows the newest scan from Content/PhoneTwinScans (downloaded from GitHub) as a point cloud
//  * receives the phone pose (PTP1) and the ESP32 UWB+IMU pose (PTE1) on UDP 7777; a switch picks the source
//  * measures the distance from the tracked hand to the scanned surfaces / objects every frame
//  * sends vibration strength (PTH1) back to the ESP32 (4210) and the phone (4211), and plays per-object sounds
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "PhoneTwinCore.h"
#include "PhoneTwinScanActor.generated.h"

class ULidarPointCloudComponent;
class UCameraComponent;
class UAudioComponent;
class USoundBase;
class FSocket;
class SWidget;
class IWebSocket;
struct FPhoneTwinLoaded;

UENUM(BlueprintType)
enum class EPhoneTwinSource : uint8
{
	Phone UMETA(DisplayName = "휴대폰 (ARCore)"),
	Esp32 UMETA(DisplayName = "ESP32 (UWB + IMU)")
};

DECLARE_DYNAMIC_MULTICAST_DELEGATE_FourParams(FPhoneTwinProximity, float, DistanceCm, float, Intensity01, int32, ObjectId, const FString&, ObjectName);

UCLASS(Blueprintable, meta = (DisplayName = "Phone Twin Scan"))
class PHONETWINLINK_API APhoneTwinScanActor : public AActor
{
	GENERATED_BODY()
public:
	APhoneTwinScanActor();

	// ---------------------------------------------------------------- scan
	/** Scan to show (file name without .ply in Content/PhoneTwinScans). Empty = always the newest. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Phone Twin|Scan")
	FString ScanId;

	/** Download new scans from GitHub at start and every SyncIntervalSeconds (Project Settings > Phone Twin). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Phone Twin|Scan")
	bool bAutoSync = true;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Phone Twin|Scan", meta = (ClampMin = "0.1"))
	float PointSize = 1.5f;

	// ---------------------------------------------------------------- input switch
	/** Which device moves the hand in the scan: the phone (ARCore) or the ESP32 (UWB position + IMU rotation). Keys 1 / 2. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Phone Twin|Input")
	EPhoneTwinSource Source = EPhoneTwinSource::Phone;

	UPROPERTY(EditAnywhere, Category = "Phone Twin|Input")
	int32 ListenPort = 7777;

	/** ESP32 address for vibration. Empty = learn it from its PTE1 packets. */
	UPROPERTY(EditAnywhere, Category = "Phone Twin|Input")
	FString EspAddress;

	UPROPERTY(EditAnywhere, Category = "Phone Twin|Input")
	int32 EspHapticPort = 4210;

	UPROPERTY(EditAnywhere, Category = "Phone Twin|Input")
	int32 PhoneHapticPort = 4211;

	/** Vibrate the ESP32 wristband even while the phone is the source. */
	UPROPERTY(EditAnywhere, Category = "Phone Twin|Input")
	bool bAlwaysVibrateEsp = true;

	/** Vibrate the phone even while the ESP32 is the source. */
	UPROPERTY(EditAnywhere, Category = "Phone Twin|Input")
	bool bAlwaysVibratePhone = false;

	/** Also connect to the internet relay set in Project Settings > Phone Twin > Relay (both paths work at the same time). */
	UPROPERTY(EditAnywhere, Category = "Phone Twin|Input")
	bool bUseRelay = true;

	UPROPERTY(EditAnywhere, Category = "Phone Twin|Input", meta = (ClampMin = "5", ClampMax = "120"))
	float SendRateHz = 30.f;

	/** A source counts as lost when no packet arrived for this long. */
	UPROPERTY(EditAnywhere, Category = "Phone Twin|Input", meta = (ClampMin = "0.1"))
	float SignalTimeout = .5f;

	/** ESP32 room frame (R) -> scan: where R's origin is (cm), extra yaw (deg) and scale. Zero/0/1 when UWB anchor 0 is on floor mark A and anchor 1 is towards B. */
	UPROPERTY(EditAnywhere, Category = "Phone Twin|ESP32 Frame")
	FVector EspOrigin = FVector::ZeroVector;

	UPROPERTY(EditAnywhere, Category = "Phone Twin|ESP32 Frame")
	float EspYawOffset = 0.f;

	UPROPERTY(EditAnywhere, Category = "Phone Twin|ESP32 Frame", meta = (ClampMin = "0.01"))
	float EspScale = 1.f;

	// ---------------------------------------------------------------- reaction
	/** Vibration starts at this distance (cm) and is strongest at ContactDistance. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Phone Twin|Reaction", meta = (ClampMin = "1"))
	float ReactRange = 30.f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Phone Twin|Reaction", meta = (ClampMin = "0"))
	float ContactDistance = 3.f;

	/** Hand = tracked point + this many cm along its forward direction. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Phone Twin|Reaction")
	float ProbeOffset = 0.f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Phone Twin|Reaction")
	bool bReactToSurfaces = true;

	/** Ignore scan points less than FloorMargin above the floor. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Phone Twin|Reaction")
	bool bIgnoreFloor = true;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Phone Twin|Reaction")
	float FloorMargin = 10.f;

	// ---------------------------------------------------------------- sound
	/** Sound per object: key = AI label ("chair", "potted plant"…) or the placed object's name ("사물 1"). Looping sounds work best. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Phone Twin|Sound")
	TMap<FString, TObjectPtr<USoundBase>> ObjectSounds;

	/** Used for objects without an entry in ObjectSounds. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Phone Twin|Sound")
	TObjectPtr<USoundBase> DefaultObjectSound;

	/** When an object has no sound at all, play a built-in beep (pitch differs per kind of object). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Phone Twin|Sound")
	bool bBuiltinBeep = true;

	/** Object sounds start at this distance (cm) and reach full volume at SoundFullDistance. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Phone Twin|Sound")
	float SoundRange = 400.f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Phone Twin|Sound")
	float SoundFullDistance = 50.f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Phone Twin|Sound", meta = (ClampMin = "1"))
	int32 MaxSimultaneousSounds = 3;

	/** Optional looping sound for "close to any surface": volume follows the vibration strength. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Phone Twin|Sound")
	TObjectPtr<USoundBase> SurfaceSound;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Phone Twin|Sound", meta = (ClampMin = "0"))
	float MasterVolume = 1.f;

	// ---------------------------------------------------------------- view
	/** Look through the tracked device (key C). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Phone Twin|View")
	bool bFollowTracker = false;

	UPROPERTY(EditAnywhere, Category = "Phone Twin|View")
	bool bShowHud = true;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Phone Twin|View")
	bool bDrawDebug = true;

	/** Hide the level's static meshes so only the scan is visible (key H). Collision stays. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Phone Twin|View")
	bool bHideLevelGeometry = false;

	// ---------------------------------------------------------------- live readouts
	UPROPERTY(BlueprintReadOnly, Category = "Phone Twin|State") bool bTracking = false;
	UPROPERTY(BlueprintReadOnly, Category = "Phone Twin|State") float DistanceCm = -1.f;
	UPROPERTY(BlueprintReadOnly, Category = "Phone Twin|State") float Intensity = 0.f;
	UPROPERTY(BlueprintReadOnly, Category = "Phone Twin|State") bool bContact = false;
	UPROPERTY(BlueprintReadOnly, Category = "Phone Twin|State") int32 ObjectId = -1;
	UPROPERTY(BlueprintReadOnly, Category = "Phone Twin|State") FString ObjectName;
	UPROPERTY(BlueprintReadOnly, Category = "Phone Twin|State") FString LoadedScanId;

	/** Fires at SendRateHz with the current distance/strength — hook your own sounds or effects here. */
	UPROPERTY(BlueprintAssignable, Category = "Phone Twin")
	FPhoneTwinProximity OnProximity;

	UFUNCTION(BlueprintCallable, Category = "Phone Twin") void SetSource(EPhoneTwinSource NewSource);
	UFUNCTION(BlueprintCallable, Category = "Phone Twin") void ToggleSource();
	UFUNCTION(BlueprintCallable, Category = "Phone Twin") void SetFollowTracker(bool bFollow);
	UFUNCTION(BlueprintCallable, Category = "Phone Twin") void SetHideLevelGeometry(bool bHide);
	UFUNCTION(BlueprintCallable, Category = "Phone Twin") void SyncNow();
	/** Load a scan by id (empty = newest). */
	UFUNCTION(BlueprintCallable, Category = "Phone Twin") void LoadScan(const FString& Id);
	UFUNCTION(BlueprintCallable, Category = "Phone Twin") void LoadNextScan();
	UFUNCTION(BlueprintPure, Category = "Phone Twin") FTransform GetTrackerTransform() const;

	/** Multi-line status for the HUD. */
	FString HudText() const;
	FString SourceText(EPhoneTwinSource S) const;
	bool IsSourceAlive(EPhoneTwinSource S) const;

protected:
	virtual void BeginPlay() override;
	virtual void EndPlay(const EEndPlayReason::Type Reason) override;
	virtual void Tick(float DeltaSeconds) override;

	UPROPERTY(VisibleAnywhere, Category = "Phone Twin") TObjectPtr<USceneComponent> Root;
	UPROPERTY(VisibleAnywhere, Category = "Phone Twin") TObjectPtr<ULidarPointCloudComponent> Cloud;
	UPROPERTY(VisibleAnywhere, Category = "Phone Twin") TObjectPtr<USceneComponent> Tracker;
	UPROPERTY(VisibleAnywhere, Category = "Phone Twin") TObjectPtr<UCameraComponent> TrackerCamera;
	UPROPERTY() TObjectPtr<UAudioComponent> SurfaceAudio;
	UPROPERTY() TArray<TObjectPtr<UAudioComponent>> ObjectAudio;

private:
	struct FObjectUE { int32 Id; FString Label, Name; FVector C; double R; bool bAi; };
	struct FLink { double LastTime = -1e9; FString Address; uint32 Seq = 0; int64 Packets = 0; };

	void OpenSocket();
	void HandleLine(const FString& Line, const FString& From);
	void ConnectRelay();
	void TickRelay(float DeltaSeconds);
	void Receive();
	void SendHaptics();
	void SendTo(const FString& Address, int32 Port, const FString& Line);
	void UpdateTracker();
	void Measure();
	void UpdateSounds();
	void DrawDebug() const;
	void HandleKeys();
	void ApplyScan(const FString& Id, TSharedPtr<FPhoneTwinLoaded> Data);
	void OnSynced(bool bNewFiles, const FString& Status);
	void ShowMouse(bool bShow);

	FSocket* Socket = nullptr;
	FLink Phone, Esp; double EspAckTime = -1e9;
	PhoneTwin::FPhonePose PhonePose; PhoneTwin::FEspPose EspPose;
	uint32 SendSeq = 0; double SendAccum = 0, SyncTimer = 0;

	PhoneTwin::FScanFrame Frame; PhoneTwin::FPointGrid Grid; double FloorZ = 0; int32 PointCount = 0;
	TArray<FObjectUE> Objects;
	FVector NearestPoint = FVector::ZeroVector; bool bHasNearest = false;
	FVector TrackerPos = FVector::ZeroVector; FRotator TrackerRot = FRotator::ZeroRotator; FVector Probe = FVector::ZeroVector;
	bool bLoading = false, bMouse = false;
	FString ScanStatus = TEXT("스캔 없음"), PhoneScanId;
	FDelegateHandle SyncHandle;
	TSharedPtr<SWidget> Hud;
	TArray<TWeakObjectPtr<AActor>> HiddenActors;

	TSharedPtr<IWebSocket> Relay;
	FString RelayStatus, RelayPeers;
	double RelayRetry = 0, RelayPing = 0;
	TArray<double> RelayRtt;
};
