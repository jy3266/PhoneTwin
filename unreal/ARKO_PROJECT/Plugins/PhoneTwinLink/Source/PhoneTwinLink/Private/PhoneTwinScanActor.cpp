#include "PhoneTwinScanActor.h"
#include "PhoneTwinCloud.h"
#include "PhoneTwinSync.h"
#include "PhoneTwinToneWave.h"
#include "LidarPointCloud.h"
#include "LidarPointCloudComponent.h"
#include "Camera/CameraComponent.h"
#include "Components/AudioComponent.h"
#include "Sound/SoundBase.h"
#include "Sockets.h"
#include "SocketSubsystem.h"
#include "Common/UdpSocketBuilder.h"
#include "Interfaces/IPv4/IPv4Address.h"
#include "DrawDebugHelpers.h"
#include "EngineUtils.h"
#include "Engine/StaticMeshActor.h"
#include "Engine/GameViewportClient.h"
#include "Engine/World.h"
#include "GameFramework/PlayerController.h"
#include "InputCoreTypes.h"
#include "Async/Async.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Styling/CoreStyle.h"
#include "Widgets/SCompoundWidget.h"
#include "Widgets/DeclarativeSyntaxSupport.h"
#include "Widgets/SBoxPanel.h"
#include "Widgets/Layout/SBorder.h"
#include "Widgets/Layout/SBox.h"
#include "Widgets/Input/SButton.h"
#include "Widgets/Text/STextBlock.h"
#include "Widgets/Notifications/SProgressBar.h"

DEFINE_LOG_CATEGORY_STATIC(LogPhoneTwin, Log, All);

struct FPhoneTwinLoaded
{
	TArray<FLidarPointCloudPoint> Points;
	PhoneTwin::FScanMeta Meta;
	PhoneTwin::FScanFrame Frame;
	PhoneTwin::FPointGrid Grid;
	double FloorZ = 0;
	FString Error;
};

// Console: "PhoneTwin.Source phone|esp32", "PhoneTwin.Follow", "PhoneTwin.NextScan" (also usable from -ExecCmds)
static FAutoConsoleCommandWithWorldAndArgs GPhoneTwinSourceCmd(TEXT("PhoneTwin.Source"), TEXT("PhoneTwin.Source phone|esp32 — which device moves the hand"),
	FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
	{
		if (!World) return;
		for (TActorIterator<APhoneTwinScanActor> It(World); It; ++It)
			if (Args.Num() == 0) It->ToggleSource();
			else It->SetSource(Args[0].StartsWith(TEXT("e"), ESearchCase::IgnoreCase) ? EPhoneTwinSource::Esp32 : EPhoneTwinSource::Phone);
	}));
static FAutoConsoleCommandWithWorldAndArgs GPhoneTwinFollowCmd(TEXT("PhoneTwin.Follow"), TEXT("Toggle looking through the tracked device"),
	FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>&, UWorld* World)
	{
		if (World) for (TActorIterator<APhoneTwinScanActor> It(World); It; ++It) It->SetFollowTracker(!It->bFollowTracker);
	}));
static FAutoConsoleCommandWithWorldAndArgs GPhoneTwinNextCmd(TEXT("PhoneTwin.NextScan"), TEXT("Show the next scan in Content/PhoneTwinScans"),
	FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>&, UWorld* World)
	{
		if (World) for (TActorIterator<APhoneTwinScanActor> It(World); It; ++It) It->LoadNextScan();
	}));

// ================================================================================================ HUD (Slate, no assets needed)
class SPhoneTwinHud : public SCompoundWidget
{
public:
	SLATE_BEGIN_ARGS(SPhoneTwinHud) {}
		SLATE_ARGUMENT(TWeakObjectPtr<APhoneTwinScanActor>, Owner)
	SLATE_END_ARGS()

	void Construct(const FArguments& Args)
	{
		Owner = Args._Owner;
		const FSlateFontInfo Title = FCoreStyle::GetDefaultFontStyle("Bold", 15), Body = FCoreStyle::GetDefaultFontStyle("Regular", 11), Small = FCoreStyle::GetDefaultFontStyle("Regular", 9);
		auto Button = [this, Body](const FText& Label, TFunction<void(APhoneTwinScanActor*)> Click, TFunction<FLinearColor(APhoneTwinScanActor*)> Color = nullptr)
		{
			return SNew(SButton)
				.HAlign(HAlign_Center)
				.ButtonColorAndOpacity_Lambda([this, Color]() { APhoneTwinScanActor* A = Owner.Get(); return A && Color ? FSlateColor(Color(A)) : FSlateColor(FLinearColor(.25f, .3f, .36f)); })
				.OnClicked_Lambda([this, Click]() { if (APhoneTwinScanActor* A = Owner.Get()) Click(A); return FReply::Handled(); })
				[ SNew(STextBlock).Text(Label).Font(Body).ColorAndOpacity(FLinearColor::White) ];
		};
		auto SourceColor = [](EPhoneTwinSource S) { return [S](APhoneTwinScanActor* A) {
			return A->Source != S ? FLinearColor(.22f, .26f, .32f) : A->IsSourceAlive(S) ? FLinearColor(.05f, .55f, .3f) : FLinearColor(.75f, .45f, .05f); }; };

		ChildSlot.HAlign(HAlign_Left).VAlign(VAlign_Top).Padding(14)
		[
			SNew(SBorder).BorderImage(FCoreStyle::Get().GetBrush("WhiteBrush")).BorderBackgroundColor(FLinearColor(.015f, .03f, .05f, .82f)).Padding(12)
			[
				SNew(SBox).WidthOverride(440)
				[
					SNew(SVerticalBox)
					+ SVerticalBox::Slot().AutoHeight()
					[ SNew(STextBlock).Text(FText::FromString(TEXT("PHONE TWIN v4  ·  ARKO"))).Font(Title).ColorAndOpacity(FLinearColor(.49f, .83f, .99f)) ]
					+ SVerticalBox::Slot().AutoHeight().Padding(0, 8, 0, 4)
					[
						SNew(SHorizontalBox)
						+ SHorizontalBox::Slot().FillWidth(1).Padding(0, 0, 4, 0)
						[ Button(FText::FromString(TEXT("[1] 휴대폰 (ARCore)")), [](APhoneTwinScanActor* A) { A->SetSource(EPhoneTwinSource::Phone); }, SourceColor(EPhoneTwinSource::Phone)) ]
						+ SHorizontalBox::Slot().FillWidth(1).Padding(4, 0, 0, 0)
						[ Button(FText::FromString(TEXT("[2] ESP32 (UWB+IMU)")), [](APhoneTwinScanActor* A) { A->SetSource(EPhoneTwinSource::Esp32); }, SourceColor(EPhoneTwinSource::Esp32)) ]
					]
					+ SVerticalBox::Slot().AutoHeight().Padding(0, 4)
					[ SNew(STextBlock).Font(Body).ColorAndOpacity(FLinearColor::White).AutoWrapText(true)
						.Text_Lambda([this]() { APhoneTwinScanActor* A = Owner.Get(); return FText::FromString(A ? A->HudText() : FString()); }) ]
					+ SVerticalBox::Slot().AutoHeight().Padding(0, 4)
					[ SNew(SBox).HeightOverride(14)
						[ SNew(SProgressBar)
							.Percent_Lambda([this]() { APhoneTwinScanActor* A = Owner.Get(); return TOptional<float>(A ? A->Intensity : 0.f); })
							.FillColorAndOpacity_Lambda([this]() { APhoneTwinScanActor* A = Owner.Get(); return FSlateColor(A && A->bContact ? FLinearColor(1, .15f, .1f) : FLinearColor(1, .55f, .1f)); }) ] ]
					+ SVerticalBox::Slot().AutoHeight().Padding(0, 6, 0, 2)
					[
						SNew(SHorizontalBox)
						+ SHorizontalBox::Slot().FillWidth(1).Padding(0, 0, 3, 0) [ Button(FText::FromString(TEXT("[G] GitHub 동기화")), [](APhoneTwinScanActor* A) { A->SyncNow(); }) ]
						+ SHorizontalBox::Slot().FillWidth(1).Padding(3, 0, 3, 0) [ Button(FText::FromString(TEXT("[N] 다음 스캔")), [](APhoneTwinScanActor* A) { A->LoadNextScan(); }) ]
						+ SHorizontalBox::Slot().FillWidth(1).Padding(3, 0, 0, 0) [ Button(FText::FromString(TEXT("[C] 시점 따라가기")), [](APhoneTwinScanActor* A) { A->SetFollowTracker(!A->bFollowTracker); },
							[](APhoneTwinScanActor* A) { return A->bFollowTracker ? FLinearColor(.05f, .4f, .6f) : FLinearColor(.25f, .3f, .36f); }) ]
					]
					+ SVerticalBox::Slot().AutoHeight().Padding(0, 4, 0, 0)
					[ SNew(STextBlock).Font(Small).ColorAndOpacity(FLinearColor(.6f, .66f, .73f)).AutoWrapText(true)
						.Text(FText::FromString(TEXT("1·2 입력 전환 · C 시점 · H 레벨 메쉬 숨김 · N 다음 스캔 · G 동기화 · M 마우스 커서"))) ]
				]
			]
		];
	}
private:
	TWeakObjectPtr<APhoneTwinScanActor> Owner;
};

// ================================================================================================ actor
APhoneTwinScanActor::APhoneTwinScanActor()
{
	PrimaryActorTick.bCanEverTick = true;
	Root = CreateDefaultSubobject<USceneComponent>(TEXT("Root")); RootComponent = Root;
	Cloud = CreateDefaultSubobject<ULidarPointCloudComponent>(TEXT("PointCloud")); Cloud->SetupAttachment(Root);
	Cloud->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	Tracker = CreateDefaultSubobject<USceneComponent>(TEXT("Tracker")); Tracker->SetupAttachment(Root);
	TrackerCamera = CreateDefaultSubobject<UCameraComponent>(TEXT("TrackerCamera")); TrackerCamera->SetupAttachment(Tracker);
	TrackerCamera->SetFieldOfView(75.f);
}

void APhoneTwinScanActor::BeginPlay()
{
	Super::BeginPlay();
	OpenSocket();
	SurfaceAudio = NewObject<UAudioComponent>(this); SurfaceAudio->bAutoActivate = false; SurfaceAudio->bAllowSpatialization = false;
	SurfaceAudio->SetupAttachment(Tracker); SurfaceAudio->RegisterComponent();

	if (bShowHud)
		if (UGameViewportClient* VP = GetWorld()->GetGameViewport())
		{
			Hud = SNew(SPhoneTwinHud).Owner(this);
			VP->AddViewportWidgetContent(Hud.ToSharedRef(), 50);
		}
	SyncHandle = FPhoneTwinSync::Get().OnSynced.AddUObject(this, &APhoneTwinScanActor::OnSynced);
	LoadScan(ScanId);
	if (bAutoSync) SyncNow();
	if (bHideLevelGeometry) SetHideLevelGeometry(true);
	if (bFollowTracker) SetFollowTracker(true);
}

void APhoneTwinScanActor::EndPlay(const EEndPlayReason::Type Reason)
{
	// make sure no motor keeps running
	if (Socket) { bTracking = false; Intensity = 0; bContact = false; SendHaptics(); }
	FPhoneTwinSync::Get().OnSynced.Remove(SyncHandle);
	if (Hud.IsValid()) if (UGameViewportClient* VP = GetWorld()->GetGameViewport()) VP->RemoveViewportWidgetContent(Hud.ToSharedRef());
	Hud.Reset();
	if (Socket) { Socket->Close(); ISocketSubsystem::Get(PLATFORM_SOCKETSUBSYSTEM)->DestroySocket(Socket); Socket = nullptr; }
	SetHideLevelGeometry(false);
	Super::EndPlay(Reason);
}

// ------------------------------------------------------------------------------------------------ UDP
void APhoneTwinScanActor::OpenSocket()
{
	Socket = FUdpSocketBuilder(TEXT("PhoneTwinUdp")).AsNonBlocking().AsReusable()
		.BoundToAddress(FIPv4Address::Any).BoundToPort(ListenPort).WithReceiveBufferSize(1 << 16).WithSendBufferSize(1 << 16).WithBroadcast().Build();
	if (!Socket) { UE_LOG(LogPhoneTwin, Error, TEXT("UDP %d를 열 수 없습니다 (다른 프로그램이 사용 중?)"), ListenPort); }
	else { UE_LOG(LogPhoneTwin, Log, TEXT("UDP %d listening"), ListenPort); }
}

void APhoneTwinScanActor::Receive()
{
	if (!Socket) return;
	ISocketSubsystem* SS = ISocketSubsystem::Get(PLATFORM_SOCKETSUBSYSTEM);
	TSharedRef<FInternetAddr> From = SS->CreateInternetAddr();
	uint8 Buf[1024]; int32 Read = 0; uint32 Pending = 0;
	const double Now = GetWorld()->GetTimeSeconds();
	while (Socket->HasPendingData(Pending) && Socket->RecvFrom(Buf, sizeof(Buf) - 1, Read, *From))
	{
		Buf[Read] = 0;
		FString Text = UTF8_TO_TCHAR((const ANSICHAR*)Buf);
		TArray<FString> Lines; Text.ParseIntoArrayLines(Lines);
		const FString Ip = From->ToString(false);
		for (const FString& L : Lines)
		{
			if (L.StartsWith(TEXT("PTP1")))
			{
				PhoneTwin::FPhonePose P;
				if (PhoneTwin::ParsePTP(L, P)) { PhonePose = P; Phone.LastTime = Now; Phone.Address = Ip; Phone.Seq = P.Seq; Phone.Packets++; PhoneScanId = P.ScanId; }
			}
			else if (L.StartsWith(TEXT("PTE1")))
			{
				PhoneTwin::FEspPose E;
				if (PhoneTwin::ParsePTE(L, E)) { EspPose = E; Esp.LastTime = Now; Esp.Address = Ip; Esp.Seq = E.Seq; Esp.Packets++; }
			}
			else if (L.StartsWith(TEXT("PTA1"))) EspAckTime = Now;   // vibration packets reach the ESP32
		}
	}
}

void APhoneTwinScanActor::SendTo(const FString& Address, int32 Port, const FString& Line)
{
	if (!Socket || Address.IsEmpty()) return;
	ISocketSubsystem* SS = ISocketSubsystem::Get(PLATFORM_SOCKETSUBSYSTEM);
	TSharedRef<FInternetAddr> To = SS->CreateInternetAddr();
	bool bValidIp = false; To->SetIp(*Address, bValidIp); To->SetPort(Port);
	if (!bValidIp) return;
	FTCHARToUTF8 U(*Line); int32 Sent = 0;
	Socket->SendTo((const uint8*)U.Get(), U.Length(), Sent, *To);
}

void APhoneTwinScanActor::SendHaptics()
{
	const FString Line = PhoneTwin::MakePTH(++SendSeq, bTracking, Intensity, bContact, ObjectId, DistanceCm < 0 ? 1e9 : DistanceCm);
	const FString EspIp = !EspAddress.IsEmpty() ? EspAddress : Esp.Address;
	if (Source == EPhoneTwinSource::Esp32 || bAlwaysVibrateEsp) SendTo(EspIp, EspHapticPort, Line);
	if (Source == EPhoneTwinSource::Phone || bAlwaysVibratePhone) SendTo(Phone.Address, PhoneHapticPort, Line);
}

bool APhoneTwinScanActor::IsSourceAlive(EPhoneTwinSource S) const
{
	const UWorld* W = GetWorld(); if (!W) return false;
	const FLink& L = S == EPhoneTwinSource::Phone ? Phone : Esp;
	const bool bValid = S == EPhoneTwinSource::Phone ? PhonePose.bValid : EspPose.bValid;
	return W->GetTimeSeconds() - L.LastTime < SignalTimeout && bValid;
}

// ------------------------------------------------------------------------------------------------ per frame
void APhoneTwinScanActor::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	Receive();
	HandleKeys();
	UpdateTracker();
	Measure();
	UpdateSounds();
	if (bDrawDebug) DrawDebug();

	SendAccum += DeltaSeconds;
	if (SendAccum >= 1.0 / SendRateHz)
	{
		SendAccum = FMath::Fmod(SendAccum, 1.0 / SendRateHz);
		SendHaptics();
		OnProximity.Broadcast(DistanceCm, Intensity, ObjectId, ObjectName);
	}
	if (bAutoSync && !FPhoneTwinSync::Get().IsRunning())
	{
		SyncTimer += DeltaSeconds;
		if (SyncTimer > GetDefault<UPhoneTwinSettings>()->SyncIntervalSeconds) SyncNow();
	}
}

void APhoneTwinScanActor::UpdateTracker()
{
	bTracking = IsSourceAlive(Source);
	if (!bTracking) return;
	if (Source == EPhoneTwinSource::Phone)
	{
		TrackerPos = Frame.Point(PhonePose.P);
		const FVector F = Frame.Dir(PhonePose.F), U = Frame.Dir(PhonePose.U);
		TrackerRot = FRotationMatrix::MakeFromXZ(F, U).Rotator();
	}
	else
	{
		const FRotator Yaw(0, EspYawOffset, 0);
		TrackerPos = EspOrigin + Yaw.RotateVector(PhoneTwin::RoomToUnreal(EspPose.X, EspPose.Y, EspPose.Z) * EspScale);
		TrackerRot = PhoneTwin::RoomRotToUnreal(EspPose.Yaw, EspPose.Pitch, EspPose.Roll); TrackerRot.Yaw += EspYawOffset;
	}
	Tracker->SetWorldLocationAndRotation(GetActorTransform().TransformPosition(TrackerPos), GetActorTransform().TransformRotation(TrackerRot.Quaternion()));
	Probe = TrackerPos + TrackerRot.Vector() * ProbeOffset;
}

void APhoneTwinScanActor::Measure()
{
	bHasNearest = false;
	if (!bTracking)
	{
		DistanceCm = -1; Intensity = 0; bContact = false; ObjectId = -1; ObjectName.Reset();
		return;
	}
	double Best = TNumericLimits<double>::Max(); int32 Obj = -1; FVector Near = Probe;
	if (bReactToSurfaces && !Grid.IsEmpty())
	{
		FVector P;
		const double D = Grid.Nearest(Probe, ReactRange, bIgnoreFloor ? FloorZ + FloorMargin : -1e12, P);
		if (D < Best)
		{
			Best = D; Near = P; Obj = 0;
			for (const FObjectUE& O : Objects) if (O.bAi && FVector::Dist(P, O.C) < O.R + 10.0) { Obj = O.Id; break; }   // surface of a recognised object
		}
	}
	for (const FObjectUE& O : Objects)
	{
		if (O.bAi) continue;   // AI objects are approximate spheres; their surface comes from the scan
		const FVector D = Probe - O.C; const double Len = D.Size(), Dist = FMath::Max(0.0, Len - O.R);
		if (Dist < Best) { Best = Dist; Obj = O.Id; Near = Len > 1e-3 ? O.C + D / Len * O.R : Probe; }
	}
	Intensity = PhoneTwin::Intensity(Best, ReactRange, ContactDistance);
	bContact = Best <= FMath::Min<double>(ContactDistance, ReactRange * .9);
	if (Best >= ReactRange) { Obj = -1; DistanceCm = -1; } else { DistanceCm = Best; NearestPoint = Near; bHasNearest = true; }
	ObjectId = Obj; ObjectName.Reset();
	if (Obj == 0) ObjectName = TEXT("스캔 표면");
	for (const FObjectUE& O : Objects) if (O.Id == Obj) ObjectName = O.Name;
}

void APhoneTwinScanActor::UpdateSounds()
{
	// surface proximity sound
	if (SurfaceSound && SurfaceAudio)
	{
		if (SurfaceAudio->Sound != SurfaceSound) SurfaceAudio->SetSound(SurfaceSound);
		const float V = Intensity * MasterVolume;
		if (V > .01f) { SurfaceAudio->SetVolumeMultiplier(V); SurfaceAudio->SetPitchMultiplier(1.f + .5f * Intensity); if (!SurfaceAudio->IsPlaying()) SurfaceAudio->Play(); }
		else if (SurfaceAudio->IsPlaying()) SurfaceAudio->Stop();
	}
	// object sounds: nearest MaxSimultaneousSounds within SoundRange, louder when closer, 30% when behind
	TArray<TPair<double, int32>> Near;
	if (bTracking)
		for (int32 i = 0; i < Objects.Num(); i++)
		{
			const double D = FMath::Max(0.0, FVector::Dist2D(TrackerPos, Objects[i].C) - Objects[i].R);
			if (D < SoundRange) Near.Add({D, i});
		}
	Near.Sort([](const TPair<double, int32>& A, const TPair<double, int32>& B) { return A.Key < B.Key; });
	TArray<float> Gain; Gain.SetNumZeroed(Objects.Num());
	const FVector Fwd = FVector(TrackerRot.Vector().X, TrackerRot.Vector().Y, 0).GetSafeNormal();
	for (int32 k = 0; k < FMath::Min(MaxSimultaneousSounds, Near.Num()); k++)
	{
		const int32 i = Near[k].Value; const double D = Near[k].Key;
		const double G = D <= SoundFullDistance ? 1.0 : FMath::Clamp((SoundRange - D) / FMath::Max(1.0, (double)(SoundRange - SoundFullDistance)), 0.0, 1.0);
		const FVector To = FVector(Objects[i].C.X - TrackerPos.X, Objects[i].C.Y - TrackerPos.Y, 0).GetSafeNormal();
		const double Front = Fwd.IsNearlyZero() || To.IsNearlyZero() ? 1.0 : FVector::DotProduct(Fwd, To);
		Gain[i] = (float)(G * G * (Front >= 0 ? 1.0 : FMath::Lerp(1.0, .3, -Front)));
	}
	for (int32 i = 0; i < ObjectAudio.Num() && i < Gain.Num(); i++)
	{
		UAudioComponent* A = ObjectAudio[i]; if (!A || !A->Sound) continue;
		const float V = Gain[i] * MasterVolume;
		if (V > .01f) { A->SetVolumeMultiplier(V); if (!A->IsPlaying()) A->Play(); }
		else if (A->IsPlaying()) A->Stop();
	}
}

void APhoneTwinScanActor::DrawDebug() const
{
	const UWorld* W = GetWorld(); const FTransform& T = GetActorTransform();
	for (const FObjectUE& O : Objects)
	{
		const bool bHot = O.Id == ObjectId;
		DrawDebugSphere(W, T.TransformPosition(O.C), O.R, 16, bHot ? FColor::Red : O.bAi ? FColor::Cyan : FColor::Yellow, false, -1, 0, bHot ? 1.5f : .5f);
		DrawDebugString(W, T.TransformPosition(O.C + FVector(0, 0, O.R + 10)), O.Name, nullptr, FColor::White, 0, true, 1.1f);
	}
	if (Frame.bAligned)
	{
		DrawDebugSphere(W, T.TransformPosition(FVector::ZeroVector), 6, 8, FColor::Green, false, -1, 0, 1);
		DrawDebugString(W, T.TransformPosition(FVector(0, 0, 12)), TEXT("A"), nullptr, FColor::Green, 0, true);
	}
	if (!bTracking) return;
	const FVector P = T.TransformPosition(TrackerPos), H = T.TransformPosition(Probe);
	const FColor C = bContact ? FColor::Red : Intensity > 0 ? FColor::Orange : FColor(40, 220, 255);
	DrawDebugSphere(W, H, 4 + 6 * Intensity, 12, C, false, -1, 0, 1.2f);
	DrawDebugDirectionalArrow(W, P, P + T.TransformVector(TrackerRot.Vector()) * 40, 12, FColor(40, 220, 255), false, -1, 0, 1.2f);
	DrawDebugSphere(W, H, ReactRange, 20, FColor(255, 160, 40, 60), false, -1, 0, .3f);
	if (bHasNearest) DrawDebugLine(W, H, T.TransformPosition(NearestPoint), FColor::Orange, false, -1, 0, 1.5f);
}

void APhoneTwinScanActor::HandleKeys()
{
	APlayerController* PC = GetWorld()->GetFirstPlayerController(); if (!PC) return;
	if (PC->WasInputKeyJustPressed(EKeys::One)) SetSource(EPhoneTwinSource::Phone);
	if (PC->WasInputKeyJustPressed(EKeys::Two)) SetSource(EPhoneTwinSource::Esp32);
	if (PC->WasInputKeyJustPressed(EKeys::C)) SetFollowTracker(!bFollowTracker);
	if (PC->WasInputKeyJustPressed(EKeys::H)) SetHideLevelGeometry(!bHideLevelGeometry);
	if (PC->WasInputKeyJustPressed(EKeys::N)) LoadNextScan();
	if (PC->WasInputKeyJustPressed(EKeys::G)) SyncNow();
	if (PC->WasInputKeyJustPressed(EKeys::M)) ShowMouse(!bMouse);
}

// ------------------------------------------------------------------------------------------------ switches
void APhoneTwinScanActor::SetSource(EPhoneTwinSource NewSource)
{
	if (Source == NewSource) return;
	// stop the device that is no longer driven
	const bool bOld = bTracking; bTracking = false; Intensity = 0; bContact = false; SendHaptics(); bTracking = bOld;
	Source = NewSource;
	UE_LOG(LogPhoneTwin, Log, TEXT("source -> %s"), *SourceText(Source));
}
void APhoneTwinScanActor::ToggleSource() { SetSource(Source == EPhoneTwinSource::Phone ? EPhoneTwinSource::Esp32 : EPhoneTwinSource::Phone); }

void APhoneTwinScanActor::SetFollowTracker(bool bFollow)
{
	bFollowTracker = bFollow;
	APlayerController* PC = GetWorld() ? GetWorld()->GetFirstPlayerController() : nullptr; if (!PC) return;
	AActor* Target = bFollow ? (AActor*)this : (AActor*)PC->GetPawn();
	if (Target) PC->SetViewTargetWithBlend(Target, .25f);
}

void APhoneTwinScanActor::SetHideLevelGeometry(bool bHide)
{
	bHideLevelGeometry = bHide;
	for (TWeakObjectPtr<AActor>& A : HiddenActors) if (A.IsValid()) A->SetActorHiddenInGame(false);
	HiddenActors.Reset();
	if (!bHide || !GetWorld()) return;
	for (TActorIterator<AStaticMeshActor> It(GetWorld()); It; ++It) if (!It->IsHidden()) { It->SetActorHiddenInGame(true); HiddenActors.Add(*It); }
}

void APhoneTwinScanActor::ShowMouse(bool bShow)
{
	APlayerController* PC = GetWorld()->GetFirstPlayerController(); if (!PC) return;
	bMouse = bShow; PC->SetShowMouseCursor(bShow);
	if (bShow) { FInputModeGameAndUI M; M.SetHideCursorDuringCapture(false); PC->SetInputMode(M); }
	else PC->SetInputMode(FInputModeGameOnly());
}

void APhoneTwinScanActor::SyncNow() { SyncTimer = 0; FPhoneTwinSync::Get().Run(); }

void APhoneTwinScanActor::OnSynced(bool bNewFiles, const FString& Status)
{
	SyncTimer = 0;
	if (bNewFiles && ScanId.IsEmpty()) LoadScan(FString());   // follow the newest scan
}

FTransform APhoneTwinScanActor::GetTrackerTransform() const { return FTransform(TrackerRot, TrackerPos) * GetActorTransform(); }

FString APhoneTwinScanActor::SourceText(EPhoneTwinSource S) const { return S == EPhoneTwinSource::Phone ? TEXT("휴대폰") : TEXT("ESP32"); }

FString APhoneTwinScanActor::HudText() const
{
	const double Now = GetWorld() ? GetWorld()->GetTimeSeconds() : 0;
	auto Link = [&](const FLink& L, bool bValid, const TCHAR* Name) {
		if (L.Packets == 0) return FString::Printf(TEXT("%s: 신호 없음 (UDP %d)"), Name, ListenPort);
		const double Age = Now - L.LastTime;
		return FString::Printf(TEXT("%s: %s · %s · %.0f ms 전%s"), Name, *L.Address, Age < SignalTimeout ? (bValid ? TEXT("추적 중") : TEXT("정렬/추적 대기")) : TEXT("끊김"),
			Age * 1000.0, Age > 5 ? TEXT(" (오래됨)") : TEXT(""));
	};
	FString S = FString::Printf(TEXT("입력: %s\n%s\n%s"), *SourceText(Source), *Link(Phone, PhonePose.bValid, TEXT("휴대폰")), *Link(Esp, EspPose.bValid, TEXT("ESP32")));
	if (Now - EspAckTime < 1.5) S += TEXT(" · 진동 응답 OK");
	if (!bTracking) S += TEXT("\n추적 대기 중 — 선택한 장치에서 신호가 오면 시작합니다");
	else if (DistanceCm < 0) S += FString::Printf(TEXT("\n범위 밖 (%.0f cm 이내에 반응)"), ReactRange);
	else S += FString::Printf(TEXT("\n%s %s  %.1f cm  · 세기 %d%%"), bContact ? TEXT("▶ 접촉") : TEXT("근접"), *ObjectName, DistanceCm, FMath::RoundToInt(Intensity * 100));
	S += FString::Printf(TEXT("\n스캔: %s"), *ScanStatus);
	if (!PhoneScanId.IsEmpty() && !LoadedScanId.IsEmpty() && PhoneScanId != LoadedScanId && Now - Phone.LastTime < 2)
		S += FString::Printf(TEXT("\n⚠ 휴대폰은 다른 스캔(%s)을 쓰고 있습니다"), *PhoneScanId);
	S += TEXT("\nGitHub: ") + FPhoneTwinSync::Get().GetStatus();
	return S;
}

// ------------------------------------------------------------------------------------------------ scans
void APhoneTwinScanActor::LoadNextScan()
{
	const TArray<FPhoneTwinLocalScan> L = FPhoneTwinSync::LocalScans();
	if (L.Num() == 0) { ScanStatus = TEXT("Content/PhoneTwinScans 에 스캔이 없습니다"); return; }
	int32 i = L.IndexOfByPredicate([this](const FPhoneTwinLocalScan& S) { return S.Id == LoadedScanId; });
	ScanId = L[(i + 1) % L.Num()].Id;
	LoadScan(ScanId);
}

void APhoneTwinScanActor::LoadScan(const FString& Id)
{
	if (bLoading) return;
	const TArray<FPhoneTwinLocalScan> L = FPhoneTwinSync::LocalScans();
	const FPhoneTwinLocalScan* Scan = Id.IsEmpty() ? (L.Num() ? &L[0] : nullptr) : L.FindByPredicate([&Id](const FPhoneTwinLocalScan& S) { return S.Id == Id; });
	if (!Scan) { ScanStatus = Id.IsEmpty() ? TEXT("Content/PhoneTwinScans 에 스캔이 없습니다 (GitHub 동기화 대기)") : FString::Printf(TEXT("%s 없음"), *Id); return; }
	if (Scan->Id == LoadedScanId) return;
	bLoading = true; ScanStatus = FString::Printf(TEXT("불러오는 중: %s"), *Scan->Id);

	TWeakObjectPtr<APhoneTwinScanActor> Weak(this);
	const FPhoneTwinLocalScan Copy = *Scan;
	Async(EAsyncExecution::ThreadPool, [Weak, Copy]()
	{
		// parse, convert and index off the game thread
		TSharedPtr<FPhoneTwinLoaded> R = MakeShared<FPhoneTwinLoaded>();
		TArray<FVector3f> S; TArray<FColor> C;
		PhoneTwin::LoadPly(Copy.PlyPath, S, C, R->Error);
		FString J; if (!Copy.MetaPath.IsEmpty() && FFileHelper::LoadFileToString(J, *Copy.MetaPath)) PhoneTwin::ParseMeta(J, R->Meta);
		R->Frame = PhoneTwin::FScanFrame::FromMeta(R->Meta);
		TArray<FVector> UE;
		PhoneTwin::ToCloudPoints(S, C, R->Frame, R->Points, &UE);
		R->Grid.Build(UE, 3.0);
		R->FloorZ = R->Frame.bAligned ? 0.0 : PhoneTwin::EstimateFloorZ(UE);
		AsyncTask(ENamedThreads::GameThread, [Weak, Copy, R]() { if (APhoneTwinScanActor* A = Weak.Get()) A->ApplyScan(Copy.Id, R); });
	});
}

void APhoneTwinScanActor::ApplyScan(const FString& Id, TSharedPtr<FPhoneTwinLoaded> Data)
{
	bLoading = false;
	const FString& Error = Data->Error;
	if (Data->Points.Num() == 0) { ScanStatus = FString::Printf(TEXT("%s 읽기 실패: %s"), *Id, *Error); return; }
	Frame = Data->Frame; Grid = MoveTemp(Data->Grid); FloorZ = Data->FloorZ; PointCount = Data->Points.Num();
	const PhoneTwin::FScanMeta& Meta = Data->Meta;

	ULidarPointCloud* PC = ULidarPointCloud::CreateFromData(Data->Points, false);
	Data->Points.Empty();
	Cloud->SetPointCloud(PC);
	Cloud->PointSize = PointSize;

	// objects + their sounds
	for (UAudioComponent* A : ObjectAudio) if (A) A->DestroyComponent();
	ObjectAudio.Reset(); Objects.Reset();
	for (const PhoneTwin::FScanObject& O : Meta.Objects)
	{
		Objects.Add({O.Id, O.Label, O.Name.IsEmpty() ? O.Label : O.Name, Frame.Point(O.C), O.R * 100.0, O.bAi});
		USoundBase* Snd = nullptr;
		if (const TObjectPtr<USoundBase>* Found = ObjectSounds.Find(O.Label)) Snd = *Found;
		if (!Snd) if (const TObjectPtr<USoundBase>* Found = ObjectSounds.Find(O.Name)) Snd = *Found;
		if (!Snd) Snd = DefaultObjectSound;
		if (!Snd && bBuiltinBeep)
		{
			UPhoneTwinToneWave* Tone = NewObject<UPhoneTwinToneWave>(this);
			Tone->Configure(440.f * FMath::Pow(2.f, (float)(GetTypeHash(O.Label) % 12) / 12.f), .6f, .25f);
			Snd = Tone;
		}
		UAudioComponent* A = NewObject<UAudioComponent>(this);
		A->bAutoActivate = false; A->bAllowSpatialization = false; A->SetSound(Snd);
		A->SetupAttachment(Root); A->RegisterComponent(); A->SetRelativeLocation(Objects.Last().C);
		ObjectAudio.Add(A);
	}
	LoadedScanId = Id;
	ScanStatus = FString::Printf(TEXT("%s · %s점 · 사물 %d%s%s"), *Id, *FText::AsNumber(PointCount).ToString(), Objects.Num(),
		Frame.bAligned ? TEXT(" · A·B 정렬") : TEXT(" · A·B 없음(스캔 원점 기준)"), Error.IsEmpty() ? TEXT("") : *(TEXT(" · 경고: ") + Error));
	UE_LOG(LogPhoneTwin, Log, TEXT("loaded %s"), *ScanStatus);
}
