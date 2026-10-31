#include "PhoneTwinScanActor.h"
#include "PhoneTwinCloud.h"
#include "PhoneTwinSync.h"
#include "PhoneTwinCalmSound.h"
#include "Kismet/GameplayStatics.h"
#include "LidarPointCloud.h"
#include "LidarPointCloudComponent.h"
#include "Camera/CameraComponent.h"
#include "Camera/PlayerCameraManager.h"
#include "Components/AudioComponent.h"
#include "Sound/SoundBase.h"
#include "Sockets.h"
#include "SocketSubsystem.h"
#include "Common/UdpSocketBuilder.h"
#include "Interfaces/IPv4/IPv4Address.h"
#include "DrawDebugHelpers.h"
#include "EngineUtils.h"
#include "Engine/StaticMeshActor.h"
#include "Engine/PostProcessVolume.h"
#include "Engine/GameViewportClient.h"
#include "Engine/World.h"
#include "GameFramework/PlayerController.h"
#include "InputCoreTypes.h"
#include "Async/Async.h"
#include "Misc/FileHelper.h"
#include "HAL/FileManager.h"
#include "Misc/Paths.h"
#include "Misc/Parse.h"
#include "Misc/CommandLine.h"
#include "Styling/CoreStyle.h"
#include "Widgets/SCompoundWidget.h"
#include "Widgets/DeclarativeSyntaxSupport.h"
#include "Widgets/SBoxPanel.h"
#include "Widgets/Layout/SBorder.h"
#include "Widgets/Layout/SBox.h"
#include "Widgets/Input/SButton.h"
#include "Widgets/Text/STextBlock.h"
#include "Widgets/Notifications/SProgressBar.h"
#include "WebSocketsModule.h"
#include "IWebSocket.h"
#include "GenericPlatform/GenericPlatformHttp.h"

DEFINE_LOG_CATEGORY_STATIC(LogPhoneTwin, Log, All);

struct FPhoneTwinLoaded
{
	TArray<FLidarPointCloudPoint> Points;
	PhoneTwin::FScanMeta Meta;
	PhoneTwin::FScanFrame Frame;
	PhoneTwin::FPointGrid Grid;
	double FloorZ = 0;
	FBox Bounds = FBox(ForceInit);
	FString Error;
};

/** Box holding the middle 96% of the points on every axis, so a few stray points do not push the overview camera away. */
static FBox RobustBounds(const TArray<FVector>& P)
{
	if (P.Num() == 0) return FBox(ForceInit);
	const int32 Step = FMath::Max(1, P.Num() / 200000);
	TArray<double> Axis[3];
	for (int32 i = 0; i < P.Num(); i += Step) for (int32 k = 0; k < 3; k++) Axis[k].Add(P[i][k]);
	FVector Lo, Hi;
	for (int32 k = 0; k < 3; k++)
	{
		Axis[k].Sort();
		Lo[k] = Axis[k][FMath::FloorToInt(Axis[k].Num() * .02)];
		Hi[k] = Axis[k][FMath::Min(Axis[k].Num() - 1, FMath::FloorToInt(Axis[k].Num() * .98))];
	}
	return FBox(Lo, Hi);
}

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
static FAutoConsoleCommandWithWorldAndArgs GPhoneTwinNextCmd(TEXT("PhoneTwin.NextScan"), TEXT("Show the next scan in <Project>/PhoneTwinScans"),
	FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>&, UWorld* World)
	{
		if (World) for (TActorIterator<APhoneTwinScanActor> It(World); It; ++It) It->LoadNextScan();
	}));

static FAutoConsoleCommandWithWorldAndArgs GPhoneTwinLightCmd(TEXT("PhoneTwin.Light"), TEXT("PhoneTwin.Light 0|1 — points brighten near the audience (no argument = toggle)"),
	FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
	{
		if (World) for (TActorIterator<APhoneTwinScanActor> It(World); It; ++It) It->SetLightUp(Args.Num() ? FCString::Atoi(*Args[0]) != 0 : !It->bLightUp);
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
						+ SHorizontalBox::Slot().FillWidth(1).Padding(3, 0, 0, 0) [ Button(FText::FromString(TEXT("[V] 보기 전환")), [](APhoneTwinScanActor* A) { A->CycleView(); },
							[](APhoneTwinScanActor* A) { return A->GetView() != EPhoneTwinView::Player ? FLinearColor(.05f, .4f, .6f) : FLinearColor(.25f, .3f, .36f); }) ]
					]
					+ SVerticalBox::Slot().AutoHeight().Padding(0, 4, 0, 0)
					[ SNew(STextBlock).Font(Small).ColorAndOpacity(FLinearColor(.6f, .66f, .73f)).AutoWrapText(true)
						.Text(FText::FromString(TEXT("1·2 입력 전환 · V 보기(전체/장치/캐릭터) · Q·E 회전 · 휠·Z·X 거리 · [ ] 점 크기 · K 빛 켬/끔 · B 콜리전 보기 · C 장치 시점 · H 점구름만/레벨 보기 · N 다음 스캔 · G 동기화 · M 마우스"))) ]
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
	OverviewCamera = CreateDefaultSubobject<UCameraComponent>(TEXT("OverviewCamera")); OverviewCamera->SetupAttachment(Root);
	OverviewCamera->SetFieldOfView(60.f);
	OverviewCamera->SetAutoActivate(false);
}

void APhoneTwinScanActor::BeginPlay()
{
	Super::BeginPlay();
	OpenSocket();
	ConnectRelay();
	SurfaceSnd = MakeObjSound(TEXT("surface"), TEXT("스캔 표면"), FVector::ZeroVector, SurfaceSound);
	// two clouds for the light animation: a worker fills the hidden one while the other is drawn (rooted until EndPlay's worker is done)
	LightBuffers.Reset();
	for (int32 i = 0; i < 2; i++) { ULidarPointCloud* B = NewObject<ULidarPointCloud>(GetTransientPackage()); B->AddToRoot(); LightBuffers.Add(B); }

	if (bShowHud)
		if (UGameViewportClient* VP = GetWorld()->GetGameViewport())
		{
			Hud = SNew(SPhoneTwinHud).Owner(this);
			VP->AddViewportWidgetContent(Hud.ToSharedRef(), 50);
		}
	SyncHandle = FPhoneTwinSync::Get().OnSynced.AddUObject(this, &APhoneTwinScanActor::OnSynced);
	FParse::Value(FCommandLine::Get(), TEXT("-PhoneTwinScan="), ScanId);   // keep one scan on show, whatever is newest
	bTrace = FParse::Param(FCommandLine::Get(), TEXT("PhoneTwinTrace"));   // once a second: distance and loudness in the log
	LoadScan(ScanId);
	if (bAutoSync) SyncNow();
	if (bHideLevelGeometry) SetHideLevelGeometry(true);
	SetView(bFollowTracker ? EPhoneTwinView::Tracker : StartView);
	ApplyLook();
}

void APhoneTwinScanActor::EndPlay(const EEndPlayReason::Type Reason)
{
	// make sure no motor keeps running
	if (Socket) { bTracking = false; Intensity = 0; bContact = false; SendHaptics(); }
	FPhoneTwinSync::Get().OnSynced.Remove(SyncHandle);
	if (Hud.IsValid()) if (UGameViewportClient* VP = GetWorld()->GetGameViewport()) VP->RemoveViewportWidgetContent(Hud.ToSharedRef());
	Hud.Reset();
	if (Relay.IsValid()) { Relay->OnClosed().Clear(); Relay->OnMessage().Clear(); Relay->Close(); Relay.Reset(); }
	if (Socket) { Socket->Close(); ISocketSubsystem::Get(PLATFORM_SOCKETSUBSYSTEM)->DestroySocket(Socket); Socket = nullptr; }
	SetHideLevelGeometry(false);
	// a light frame may still be written on a worker: wait for it, then let the buffers go after its queued game-thread work
	for (int32 i = 0; *LightWorking && i < 3000; i++) FPlatformProcess::Sleep(.001f);
	TArray<ULidarPointCloud*> Bufs; for (ULidarPointCloud* B : LightBuffers) if (B) Bufs.Add(B);
	LightBuffers.Reset(); LightBase.Reset();
	AsyncTask(ENamedThreads::GameThread, [Bufs]() { for (ULidarPointCloud* B : Bufs) B->RemoveFromRoot(); });
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
	while (Socket->HasPendingData(Pending) && Socket->RecvFrom(Buf, sizeof(Buf) - 1, Read, *From))
	{
		Buf[Read] = 0;
		FString Text = UTF8_TO_TCHAR((const ANSICHAR*)Buf);
		TArray<FString> Lines; Text.ParseIntoArrayLines(Lines);
		const FString Ip = From->ToString(false);
		for (const FString& L : Lines) HandleLine(L, Ip);
	}
}

void APhoneTwinScanActor::HandleLine(const FString& L, const FString& From)
{
	const double Now = GetWorld()->GetTimeSeconds();
	if (L.StartsWith(TEXT("PTP1")))
	{
		PhoneTwin::FPhonePose P;
		if (PhoneTwin::ParsePTP(L, P)) { PhonePose = P; Phone.LastTime = Now; Phone.Address = From; Phone.Seq = P.Seq; Phone.Packets++; PhoneScanId = P.ScanId; }
	}
	else if (L.StartsWith(TEXT("PTE1")))
	{
		PhoneTwin::FEspPose E;
		if (PhoneTwin::ParsePTE(L, E)) { EspPose = E; Esp.LastTime = Now; Esp.Address = From; Esp.Seq = E.Seq; Esp.Packets++; }
	}
	else if (L.StartsWith(TEXT("PTA1"))) EspAckTime = Now;   // vibration packets reach the ESP32
}

// ------------------------------------------------------------------------------------------------ internet relay (PROTOCOL.md §3)
void APhoneTwinScanActor::ConnectRelay()
{
	const UPhoneTwinSettings* S = GetDefault<UPhoneTwinSettings>();
	FString Base = S->RelayUrl.TrimStartAndEnd();
	if (!bUseRelay || Base.IsEmpty()) { RelayStatus.Reset(); UE_LOG(LogPhoneTwin, Log, TEXT("relay off (Project Settings > Phone Twin > Relay Url is empty)")); return; }
	Base.RemoveFromEnd(TEXT("/"));
	if (Base.StartsWith(TEXT("https://"))) Base = TEXT("wss://") + Base.Mid(8); else if (Base.StartsWith(TEXT("http://"))) Base = TEXT("ws://") + Base.Mid(7);
	const FString Url = FString::Printf(TEXT("%s/ws?room=%s&role=unreal&key=%s"), *Base, *FGenericPlatformHttp::UrlEncode(S->RelayRoom), *FGenericPlatformHttp::UrlEncode(S->RelayKey));
	FModuleManager::LoadModuleChecked<FWebSocketsModule>(TEXT("WebSockets"));
	Relay = FWebSocketsModule::Get().CreateWebSocket(Url, TEXT(""));
	RelayStatus = TEXT("연결 중…");
	TWeakObjectPtr<APhoneTwinScanActor> Weak(this);
	UE_LOG(LogPhoneTwin, Log, TEXT("relay connecting: %s/ws?room=%s&role=unreal"), *Base, *S->RelayRoom);
	Relay->OnConnected().AddLambda([Weak]() { if (Weak.IsValid()) { Weak->RelayStatus = TEXT("연결됨"); UE_LOG(LogPhoneTwin, Log, TEXT("relay connected")); } });
	Relay->OnConnectionError().AddLambda([Weak](const FString& Err) { if (Weak.IsValid()) { Weak->RelayStatus = TEXT("연결 실패: ") + Err; Weak->RelayRetry = 3; UE_LOG(LogPhoneTwin, Warning, TEXT("relay error: %s"), *Err); } });
	Relay->OnClosed().AddLambda([Weak](int32 Code, const FString& Reason, bool) { if (Weak.IsValid()) { Weak->RelayStatus = FString::Printf(TEXT("끊김 (%d)"), Code); Weak->RelayRetry = 2; } });
	Relay->OnMessage().AddLambda([Weak](const FString& Msg)
	{
		APhoneTwinScanActor* A = Weak.Get(); if (!A) return;
		TArray<FString> Lines; Msg.ParseIntoArrayLines(Lines);
		for (const FString& L : Lines)
		{
			if (L.StartsWith(TEXT("PTR1,peers,"))) A->RelayPeers = L.Mid(11).Replace(TEXT(","), TEXT(" "));
			else if (L.StartsWith(TEXT("PTR1,pong,")))
			{
				const double Ms = (FPlatformTime::Seconds() - FCString::Atod(*L.Mid(10))) * 1000.0;
				A->RelayRtt.Add(Ms); if (A->RelayRtt.Num() > 10) A->RelayRtt.RemoveAt(0);
			}
			else if (!L.StartsWith(TEXT("PTR1"))) A->HandleLine(L, TEXT("relay"));
		}
	});
	Relay->Connect();
}

void APhoneTwinScanActor::TickRelay(float DeltaSeconds)
{
	if (!Relay.IsValid()) return;
	if (RelayRetry > 0 && (RelayRetry -= DeltaSeconds) <= 0) { RelayRetry = 0; Relay.Reset(); ConnectRelay(); return; }
	if (Relay->IsConnected() && (RelayPing += DeltaSeconds) > 2.0)
	{
		RelayPing = 0;
		Relay->Send(FString::Printf(TEXT("PTR1,ping,%.6f"), FPlatformTime::Seconds()));
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

void APhoneTwinScanActor::SendBytes(const FString& Address, int32 Port, const TArray<uint8>& Bytes)
{
	if (!Socket || Address.IsEmpty()) return;
	ISocketSubsystem* SS = ISocketSubsystem::Get(PLATFORM_SOCKETSUBSYSTEM);
	TSharedRef<FInternetAddr> To = SS->CreateInternetAddr();
	bool bValidIp = false; To->SetIp(*Address, bValidIp); To->SetPort(Port);
	if (!bValidIp) return;
	int32 Sent = 0;
	Socket->SendTo(Bytes.GetData(), Bytes.Num(), Sent, *To);
}

FVector APhoneTwinScanActor::TrackerRoomM() const { return FVector(TrackerPos.X, -TrackerPos.Y, TrackerPos.Z) / 100.0; }

void APhoneTwinScanActor::SendOsc()
{
	// PROTOCOL.md §4 — room frame R: metres, origin = floor mark A, +X towards B, +Y left, +Z up
	if (!bSendOsc || OscAddress.IsEmpty()) return;
	using PhoneTwin::FOscMessage;
	const auto Room = [](const FVector& UE) { return FVector(UE.X, -UE.Y, UE.Z) / 100.0; };
	SendBytes(OscAddress, OscPort, FOscMessage(TEXT("/phonetwin/state")).Int(bTracking ? 1 : 0).Int(IsStarted() ? 1 : 0)
		.Int(Source == EPhoneTwinSource::Phone ? 0 : 1).Int(Objects.Num()).Encode());
	SendBytes(OscAddress, OscPort, FOscMessage(TEXT("/phonetwin/scan")).Str(LoadedScanId).Encode());
	if (!bTracking) return;
	const FVector P = TrackerRoomM(), F = Room(TrackerRot.Vector() * 100.0);
	SendBytes(OscAddress, OscPort, FOscMessage(TEXT("/phonetwin/pos")).Float(P.X).Float(P.Y).Float(P.Z).Encode());
	SendBytes(OscAddress, OscPort, FOscMessage(TEXT("/phonetwin/dir")).Float(F.X).Float(F.Y).Float(F.Z).Float(-TrackerRot.Yaw).Encode());
	SendBytes(OscAddress, OscPort, FOscMessage(TEXT("/phonetwin/nearest")).Int(ObjectId).Float(DistanceCm).Float(Intensity).Int(bContact ? 1 : 0).Str(ObjectName).Encode());
	for (int32 i = 0; i < Objects.Num(); i++)
	{
		// floor distance (what the audience walks) and hand distance (what the vibration uses), both to the object's surface
		const FObjectUE& O = Objects[i];
		const double Floor = O.FloorD, Hand = O.HandD;
		const FVector C = Room(O.C);
		SendBytes(OscAddress, OscPort, FOscMessage(TEXT("/phonetwin/object")).Int(i).Int(O.Id).Str(O.Name).Str(O.Label)
			.Float(Floor).Float(Hand).Float(C.X).Float(C.Y).Float(C.Z).Float(O.R).Encode());
	}
}

void APhoneTwinScanActor::SendWeb()
{
	// the web viewer listens on the relay as "viewer"; one PTU1 line shows the audience whichever device drives it
	if (!Relay.IsValid() || !Relay->IsConnected() || (!bTracking && !bWebValid)) return;
	bWebValid = bTracking;
	Relay->Send(PhoneTwin::MakePTU(++WebSeq, bTracking, Source == EPhoneTwinSource::Phone ? TEXT("phone") : TEXT("esp32"), TrackerRoomM(), -TrackerRot.Yaw, ObjectId, DistanceCm, Intensity));
}

void APhoneTwinScanActor::SendHaptics()
{
	const FString Line = PhoneTwin::MakePTH(++SendSeq, bTracking, Intensity, bContact, ObjectId, DistanceCm < 0 ? 1e9 : DistanceCm);
	const FString EspIp = !EspAddress.IsEmpty() ? EspAddress : Esp.Address;
	if (Source == EPhoneTwinSource::Esp32 || bAlwaysVibrateEsp) SendTo(EspIp, EspHapticPort, Line);
	if (Source == EPhoneTwinSource::Phone || bAlwaysVibratePhone) SendTo(Phone.Address, PhoneHapticPort, Line);
	// relay: one line reaches every phone/ESP32 in the room
	if (Relay.IsValid() && Relay->IsConnected()) Relay->Send(Line);
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
	TickRelay(DeltaSeconds);
	HandleKeys();
	UpdateTracker();
	Measure();
	UpdateSounds();
	TickCollisionFile(DeltaSeconds);
	TickLight(DeltaSeconds);
	UpdateOverview(DeltaSeconds);
	if (bDrawDebug) DrawDebug();

	if (bHideLevelGeometry && (HideTimer += DeltaSeconds) > 1.0) { HideTimer = 0; HideOthers(); }   // e.g. the character the game mode spawns
	SendAccum += DeltaSeconds;
	if (SendAccum >= 1.0 / SendRateHz)
	{
		SendAccum = FMath::Fmod(SendAccum, 1.0 / SendRateHz);
		SendHaptics();
		SendOsc();
		OnProximity.Broadcast(DistanceCm, Intensity, ObjectId, ObjectName);
	}
	WebAccum += DeltaSeconds;
	if (WebAccum >= 1.0 / WebRateHz) { WebAccum = FMath::Fmod(WebAccum, 1.0 / WebRateHz); SendWeb(); }
	if (bAutoSync && !FPhoneTwinSync::Get().IsRunning())
	{
		SyncTimer += DeltaSeconds;
		if (SyncTimer > GetDefault<UPhoneTwinSettings>()->SyncIntervalSeconds) SyncNow();
	}
}

bool APhoneTwinScanActor::IsStarted() const
{
	// The phone's "걷기 테스트 시작" is the start switch for everything. Without a phone (ESP32 only) it is always on.
	const UWorld* W = GetWorld();
	const bool bPhonePresent = W && Phone.Packets > 0 && W->GetTimeSeconds() - Phone.LastTime < 2.0;
	return !bRequirePhoneWalkStart || !bPhonePresent || PhonePose.bWalk;
}

void APhoneTwinScanActor::UpdateTracker()
{
	bTracking = IsSourceAlive(Source) && IsStarted();
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

void APhoneTwinScanActor::MeasureObjects()
{
	// every object's distance from its surface, once per frame: vibration, sound, OSC and the debug view all use these
	for (FObjectUE& O : Objects)
	{
		if (O.Cells.IsEmpty())
		{
			const FVector D = Probe - O.C; const double Len = D.Size();
			O.FloorD = FMath::Max(0.0, FVector::Dist2D(TrackerPos, O.C) - O.R); O.HandD = FMath::Max(0.0, Len - O.R);
			O.HandNear = Len > 1e-3 ? O.C + D / Len * O.R : Probe;
			continue;
		}
		double Floor2 = 1e24, Hand2 = 1e24; int32 HandAt = 0;
		for (int32 i = 0; i < O.Cells.Num(); i++)
		{
			const FVector& C = O.Cells[i];
			const double Dx = C.X - TrackerPos.X, Dy = C.Y - TrackerPos.Y, F2 = Dx * Dx + Dy * Dy;
			if (F2 < Floor2) Floor2 = F2;
			const double H2 = FVector::DistSquared(C, Probe);
			if (H2 < Hand2) { Hand2 = H2; HandAt = i; }
		}
		O.FloorD = FMath::Max(0.0, FMath::Sqrt(Floor2) - O.CellR); O.HandD = FMath::Max(0.0, FMath::Sqrt(Hand2) - O.CellR);
		O.HandNear = O.Cells[HandAt];
	}
}

void APhoneTwinScanActor::Measure()
{
	bHasNearest = false;
	if (!bTracking)
	{
		DistanceCm = -1; Intensity = 0; bContact = false; ObjectId = -1; ObjectName.Reset();
		return;
	}
	MeasureObjects();
	double Best = TNumericLimits<double>::Max(); int32 Obj = -1; FVector Near = Probe;
	if (bReactToSurfaces && !Grid.IsEmpty())
	{
		FVector P;
		const double D = Grid.Nearest(Probe, ReactRange, bIgnoreFloor ? FloorZ + FloorMargin : -1e12, P);
		if (D < Best)
		{
			Best = D; Near = P; Obj = 0;
			for (const FObjectUE& O : Objects) if (O.bAi && O.Cells.IsEmpty() && FVector::Dist(P, O.C) < O.R + 10.0) { Obj = O.Id; break; }   // surface of a recognised object
		}
	}
	for (const FObjectUE& O : Objects)
	{
		if (O.bAi && O.Cells.IsEmpty()) continue;   // old scans: AI objects are approximate spheres, their surface comes from the scan
		// a real shape lies on the scan surface: the shape wins a tie so the object gets the name and the sound
		if (O.HandD < Best + (Obj == 0 ? 3.0 : 0.0)) { Best = FMath::Min(Best, O.HandD); Obj = O.Id; Near = O.HandNear; }
	}
	Intensity = PhoneTwin::Intensity(Best, ReactRange, ContactDistance);
	bContact = Best <= FMath::Min<double>(ContactDistance, ReactRange * .9);
	if (Best >= ReactRange) { Obj = -1; DistanceCm = -1; } else { DistanceCm = Best; NearestPoint = Near; bHasNearest = true; }
	ObjectId = Obj; ObjectName.Reset();
	if (Obj == 0) ObjectName = TEXT("스캔 표면");
	for (const FObjectUE& O : Objects) if (O.Id == Obj) ObjectName = O.Name;
}

USoundBase* APhoneTwinScanActor::LoadUserSound(const FString& Ref, bool bLoop)
{
	if (Ref.IsEmpty()) return nullptr;
	USoundBase* Out = nullptr;
	if (Ref.StartsWith(TEXT("/")))
	{
		Out = LoadObject<USoundBase>(nullptr, *Ref);
		if (!Out) UE_LOG(LogPhoneTwin, Warning, TEXT("sound asset not found: %s"), *Ref);
	}
	else
	{
		UPhoneTwinFileWave* W = NewObject<UPhoneTwinFileWave>(this); FString Err;
		if (W->LoadFile(UPhoneTwinSettings::ScanDir() / TEXT("sounds") / FPaths::GetCleanFilename(Ref), bLoop, Err)) Out = W;
		else UE_LOG(LogPhoneTwin, Warning, TEXT("sound %s: %s"), *Ref, *Err);
	}
	if (Out) UserSounds.Add(Out);
	return Out;
}

APhoneTwinScanActor::FObjSound APhoneTwinScanActor::MakeObjSound(const FString& Label, const FString& Name, const FVector& Where, USoundBase* NearAsset, const FString& TouchRef)
{
	FObjSound S;
	auto NewComp = [&](USoundBase* Snd)
	{
		UAudioComponent* A = NewObject<UAudioComponent>(this);
		A->bAutoActivate = false; A->bAllowSpatialization = false; A->SetSound(Snd);
		A->SetupAttachment(Root); A->RegisterComponent(); A->SetRelativeLocation(Where);
		ObjectAudio.Add(A);
		return A;
	};
	USoundBase* EditorTouch = LoadUserSound(TouchRef, false);
	if (UPhoneTwinFileWave* W = Cast<UPhoneTwinFileWave>(EditorTouch)) { S.TouchWave = W; S.TouchComp = NewComp(W); }
	else S.TouchAsset = EditorTouch;
	if (!S.TouchAsset && !S.TouchWave) if (const TObjectPtr<USoundBase>* T = TouchSounds.Find(Label)) S.TouchAsset = *T;
	if (!S.TouchAsset && !S.TouchWave) if (const TObjectPtr<USoundBase>* T = TouchSounds.Find(Name)) S.TouchAsset = *T;
	if (!S.TouchAsset && !S.TouchWave) S.TouchAsset = DefaultTouchSound;
	if (NearAsset) S.Near = NewComp(NearAsset);
	if (bBuiltinBeep && (!NearAsset || (!S.TouchAsset && !S.TouchWave)))
	{
		// the calm voice is made from what the object is: its pad for approaching, its chime for touching
		const PhoneTwin::FCalmVoice V = PhoneTwin::CalmVoiceFor(Label);
		S.Wave = NewObject<UPhoneTwinCalmWave>(this);
		S.Wave->Configure(V); S.Idea = V.Idea;
		S.Calm = NewComp(S.Wave);
		if (!S.Near) S.Near = S.Calm;
	}
	return S;
}

void APhoneTwinScanActor::DriveSound(FObjSound& S, float NearGain, bool bTouchNow, bool bReleased, int32 Index)
{
	const double Now = GetWorld()->GetTimeSeconds();
	S.Gain = NearGain;
	// touch: one chime when it starts, then a softer one every TouchRepeatSeconds while it lasts
	if (bTouchNow && Now - S.LastStrike > (S.bTouching ? (double)TouchRepeatSeconds : .8))
	{
		const float Strength = S.bTouching ? .55f : 1.f;
		S.bTouching = true; S.LastStrike = Now;
		if (S.TouchWave)
		{
			S.TouchComp->SetVolumeMultiplier(MasterVolume * Strength * S.Volume);
			S.TouchWave->Restart();
			if (!S.TouchComp->IsPlaying()) S.TouchComp->Play();
		}
		else if (S.TouchAsset) UGameplayStatics::PlaySound2D(this, S.TouchAsset, MasterVolume * Strength * S.Volume);
		else if (S.Wave) S.Wave->Touch(Strength);
		if (bSendOsc && !OscAddress.IsEmpty())
		{
			const bool bObj = Objects.IsValidIndex(Index);
			SendBytes(OscAddress, OscPort, PhoneTwin::FOscMessage(TEXT("/phonetwin/touch")).Int(Index).Int(bObj ? Objects[Index].Id : 0)
				.Str(bObj ? Objects[Index].Name : FString(TEXT("스캔 표면"))).Float(Strength).Encode());
		}
	}
	else if (bReleased) S.bTouching = false;

	// approach layer: the user's looping sound, or the calm pad
	if (S.Wave) S.Wave->SetNear(S.Near == S.Calm ? NearGain : 0.f);
	if (S.Near && S.Near != S.Calm)
	{
		const float V = NearGain * MasterVolume;
		if (V > .01f) { S.Near->SetVolumeMultiplier(V); if (!S.Near->IsPlaying()) S.Near->Play(); }
		else if (S.Near->IsPlaying()) S.Near->Stop();
	}
	// the calm wave runs while its pad or a chime can be heard; the synth fades by itself, so stopping 3 s later is silent
	if (S.Calm)
	{
		if ((S.Near == S.Calm && NearGain > .005f) || (!S.TouchAsset && !S.TouchWave && Now - S.LastStrike < 9.0)) S.LastLoud = Now;
		if (Now - S.LastLoud < 3.0) { S.Calm->SetVolumeMultiplier(MasterVolume); if (!S.Calm->IsPlaying()) S.Calm->Play(); }
		else if (S.Calm->IsPlaying()) S.Calm->Stop();
	}
}

void APhoneTwinScanActor::UpdateSounds()
{
	const double Now = GetWorld()->GetTimeSeconds();
	// scan surface (walls, furniture without a label): the hand coming close to it
	const bool bSurface = bTracking && ObjectId == 0;
	DriveSound(SurfaceSnd, bSurface ? Intensity * .7f : 0.f, bSurface && bContact, !(bSurface && bContact), -1);

	// object sounds: nearest MaxSimultaneousSounds within SoundRange, louder when closer, 30% when behind
	TArray<TPair<double, int32>> Near;
	TArray<double> FloorD; FloorD.Init(1e12, Objects.Num());
	if (bTracking)
		for (int32 i = 0; i < Objects.Num(); i++)
		{
			const double D = Objects[i].FloorD;
			FloorD[i] = D;
			if (D < (Objects[i].MaxCm >= 0 ? Objects[i].MaxCm : SoundRange) && !Objects[i].bMuted) Near.Add({D, i});
		}
	Near.Sort([](const TPair<double, int32>& A, const TPair<double, int32>& B) { return A.Key < B.Key; });
	TArray<float> Gain; Gain.SetNumZeroed(Objects.Num());
	const FVector Fwd = FVector(TrackerRot.Vector().X, TrackerRot.Vector().Y, 0).GetSafeNormal();
	for (int32 k = 0; k < FMath::Min(MaxSimultaneousSounds, Near.Num()); k++)
	{
		const int32 i = Near[k].Value; const double D = Near[k].Key;
		// same formula as distanceGain() in web/collision_core.js
		const double Full = Objects[i].FullCm >= 0 ? Objects[i].FullCm : SoundFullDistance, Max = Objects[i].MaxCm >= 0 ? Objects[i].MaxCm : SoundRange;
		const double G = D <= Full ? 1.0 : FMath::Clamp((Max - D) / FMath::Max(1.0, Max - Full), 0.0, 1.0);
		const FVector To = FVector(Objects[i].C.X - TrackerPos.X, Objects[i].C.Y - TrackerPos.Y, 0).GetSafeNormal();
		const double Front = Fwd.IsNearlyZero() || To.IsNearlyZero() ? 1.0 : FVector::DotProduct(Fwd, To);
		Gain[i] = (float)(G * G * Objects[i].Volume * (Front >= 0 ? 1.0 : FMath::Lerp(1.0, .3, -Front)));
	}
	SoundNow.Reset(); float Loudest = .05f;
	for (int32 i = 0; i < Sounds.Num() && i < Objects.Num(); i++)
	{
		const bool bHand = bTracking && bContact && ObjectId == Objects[i].Id;
		const bool bTouch = bTracking && !Objects[i].bMuted && (bHand || FloorD[i] <= TouchDistance);
		const bool bRelease = !bTracking || (!bHand && FloorD[i] > TouchDistance + 15.0);
		DriveSound(Sounds[i], Gain[i], bTouch, bRelease, i);
		const float Shown = Now - Sounds[i].LastStrike < 2.0 ? 1.f : Gain[i];
		if (Shown > Loudest && !Sounds[i].Idea.IsEmpty()) { Loudest = Shown; SoundNow = FString::Printf(TEXT("%s%s — %s"), Now - Sounds[i].LastStrike < 2.0 ? TEXT("닿음 ") : TEXT(""), *Objects[i].Name, *Sounds[i].Idea); }
	}
}

void APhoneTwinScanActor::DrawDebug() const
{
	const UWorld* W = GetWorld(); const FTransform& T = GetActorTransform();
	for (const FObjectUE& O : Objects)
	{
		// only the object being approached gets an outline, so the point cloud stays the picture
		const bool bHot = O.Id == ObjectId;
		if (O.Cells.Num())
		{
			if (bHot || bShowCollisions)
				for (int32 i = 0; i < O.Cells.Num(); i += FMath::Max(1, O.Cells.Num() / 1500))
					DrawDebugPoint(W, T.TransformPosition(O.Cells[i]), bHot ? 6.f : 4.f, bHot ? FColor(255, 120, 80) : FColor(103, 232, 249), false, -1);
		}
		else if (bHot || (!bHideLevelGeometry && !O.bAi)) DrawDebugSphere(W, T.TransformPosition(O.C), O.R, 16, bHot ? FColor(255, 120, 80) : FColor::Yellow, false, -1, 0, bHot ? 1.f : .5f);
		DrawDebugString(W, T.TransformPosition(O.C + FVector(0, 0, O.R + 10)), O.Name, nullptr, FColor::White, 0, true, 1.1f);
	}
	if (Frame.bAligned)
	{
		DrawDebugSphere(W, T.TransformPosition(FVector::ZeroVector), 6, 8, FColor::Green, false, -1, 0, 1);
		DrawDebugString(W, T.TransformPosition(FVector(0, 0, 12)), TEXT("A"), nullptr, FColor::Green, 0, true);
	}
	if (!bTracking) return;
	// the audience as a standing figure (floor -> device) so it reads from far away, and a line + distance to every object
	const double FootZ = FMath::Min(FloorZ, TrackerPos.Z - 20);
	const FVector Foot = T.TransformPosition(FVector(TrackerPos.X, TrackerPos.Y, FootZ));
	DrawDebugCylinder(W, Foot, T.TransformPosition(TrackerPos), 16, 16, FColor(40, 220, 255), false, -1, 0, 1.5f);
	DrawDebugCircle(W, Foot, 30, 32, FColor(40, 220, 255), false, -1, 0, 2.f, T.GetUnitAxis(EAxis::X), T.GetUnitAxis(EAxis::Y), false);
	if (View == EPhoneTwinView::Overview)
		for (const FObjectUE& O : Objects)
		{
			const double D = O.FloorD;
			if (D > (O.MaxCm >= 0 ? O.MaxCm : SoundRange)) continue;
			const FVector A = T.TransformPosition(FVector(TrackerPos.X, TrackerPos.Y, FootZ + 2)), B = T.TransformPosition(FVector(O.C.X, O.C.Y, FootZ + 2));
			DrawDebugLine(W, A, B, O.Id == ObjectId ? FColor::Red : FColor(255, 200, 60), false, -1, 0, .8f);
			DrawDebugString(W, (A + B) * .5, FString::Printf(TEXT("%.0f cm"), D), nullptr, FColor::White, 0, true, 1.f);
		}
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
	if (PC->WasInputKeyJustPressed(EKeys::V)) CycleView();
	if (PC->WasInputKeyJustPressed(EKeys::LeftBracket)) SetPointSize(PointSize / 1.2f);
	if (PC->WasInputKeyJustPressed(EKeys::RightBracket)) SetPointSize(PointSize * 1.2f);
	if (PC->WasInputKeyJustPressed(EKeys::K)) SetLightUp(!bLightUp);
	if (PC->WasInputKeyJustPressed(EKeys::B)) bShowCollisions = !bShowCollisions;
}

void APhoneTwinScanActor::SetLightUp(bool bOn)
{
	bLightUp = bOn;
	LightTimer = 1e9;   // next frame right away
	if (!bLightUp && StaticCloud) Cloud->SetPointCloud(StaticCloud);
	ApplyLook();
}

void APhoneTwinScanActor::TickLight(float DeltaSeconds)
{
	// the sharp area follows the audience and fades in / out over a second when tracking starts or stops
	if (bTracking) RevealCenter = TrackerPos;
	Reveal = FMath::FInterpConstantTo(Reveal, bTracking ? 1.f : 0.f, DeltaSeconds, 1.f);
	if (!bLightUp || !LightBase.IsValid() || bLightPending || LightBuffers.Num() < 2) return;
	if ((LightTimer += DeltaSeconds) < 1.0 / LightRateHz) return;
	LightTimer = 0;

	PhoneTwin::FGlowParams P;
	P.LitRadius = LitRadius; P.FadeRadius = FadeRadius; P.NearBrightness = NearBrightness; P.FarBrightness = FarBrightness;
	P.IdleBrightness = IdleBrightness; P.NearWhite = NearWhite; P.Twinkle = Twinkle; P.Reveal = Reveal; P.MaxPoints = LightMaxPoints;
	ULidarPointCloud* Target = LightBuffers[LightNext];
	const int32 Buffer = LightNext; const uint32 Gen = LightGen;
	const FVector3f Center(RevealCenter); const double Time = GetWorld()->GetTimeSeconds();
	TSharedPtr<const TArray<FLidarPointCloudPoint>> Base = LightBase;
	TSharedRef<FThreadSafeBool> Working = LightWorking;
	TWeakObjectPtr<APhoneTwinScanActor> Weak(this);
	bLightPending = true; *Working = true;
	// build the frame and its octree off the game thread into the cloud that is not on screen
	Async(EAsyncExecution::ThreadPool, [Weak, Target, Base, P, Center, Time, Buffer, Gen, Working]()
	{
		const double T0 = FPlatformTime::Seconds();
		TArray<FLidarPointCloudPoint> Out;
		PhoneTwin::BuildGlow(*Base, P, Center, Time, Out);
		const bool bOk = Out.Num() > 0 && Target->SetData(Out);
		const float Ms = (float)((FPlatformTime::Seconds() - T0) * 1000.0); const int32 Num = Out.Num();
		*Working = false;
		AsyncTask(ENamedThreads::GameThread, [Weak, Buffer, Gen, bOk, Ms, Num]() { if (APhoneTwinScanActor* A = Weak.Get()) A->OnLightBuilt(bOk ? Buffer : -1, Gen, Ms, Num); });
	});
}

void APhoneTwinScanActor::OnLightBuilt(int32 Buffer, uint32 Gen, float Ms, int32 Num)
{
	bLightPending = false;
	LightMs = Ms;
	const double Now = FPlatformTime::Seconds();
	if (Now - LightLogTime > 10.0) { LightLogTime = Now; UE_LOG(LogPhoneTwin, Log, TEXT("light frame: %d points, %.1f ms (reveal %.2f) · game %.1f fps"), Num, Ms, Reveal, 1.0 / FMath::Max(1e-4, FApp::GetDeltaTime())); }
	if (Buffer < 0 || Gen != LightGen || !bLightUp || !LightBuffers.IsValidIndex(Buffer)) return;
	Cloud->SetPointCloud(LightBuffers[Buffer]);
	ApplyLook();
	LightNext = 1 - Buffer;
}

void APhoneTwinScanActor::SetPointSize(float NewSize)
{
	PointSize = FMath::Clamp(NewSize, .05f, 20.f);
	if (Cloud) { Cloud->PointSize = PointSize; Cloud->MarkRenderStateDirty(); }
}

void APhoneTwinScanActor::UpdateOverview(float DeltaSeconds)
{
	APlayerController* PC = GetWorld()->GetFirstPlayerController(); if (!PC) return;
	// the level's game mode possesses its character after BeginPlay and takes the view: take it back
	const bool bBlendingHere = PC->PlayerCameraManager && PC->PlayerCameraManager->PendingViewTarget.Target == this;
	if (View != EPhoneTwinView::Player && PC->GetViewTarget() != this && !bBlendingHere) PC->SetViewTarget(this);
	if (View != EPhoneTwinView::Overview) return;

	if (PC->IsInputKeyDown(EKeys::Q)) OverviewYaw -= 70.f * DeltaSeconds;
	if (PC->IsInputKeyDown(EKeys::E)) OverviewYaw += 70.f * DeltaSeconds;
	if (PC->IsInputKeyDown(EKeys::Z) || PC->WasInputKeyJustPressed(EKeys::MouseScrollUp)) OverviewDistance /= PC->IsInputKeyDown(EKeys::Z) ? FMath::Pow(1.8f, DeltaSeconds) : 1.1f;
	if (PC->IsInputKeyDown(EKeys::X) || PC->WasInputKeyJustPressed(EKeys::MouseScrollDown)) OverviewDistance *= PC->IsInputKeyDown(EKeys::X) ? FMath::Pow(1.8f, DeltaSeconds) : 1.1f;
	OverviewDistance = FMath::Clamp(OverviewDistance, .3f, 6.f);

	// frame the whole scan: look at its centre from OverviewPitch above, far enough for its largest side to fit
	const FVector Size = ScanBounds.GetSize();
	const double Span = FMath::Max3(Size.X, Size.Y, 300.0);
	const FRotator Rot(-OverviewPitch, OverviewYaw, 0);
	const FVector Want = ScanBounds.GetCenter() - Rot.Vector() * Span * OverviewDistance;
	const FTransform& T = GetActorTransform();
	const FVector Cur = T.InverseTransformPosition(OverviewCamera->GetComponentLocation());
	const FVector Loc = Cur.Equals(FVector::ZeroVector) ? Want : FMath::VInterpTo(Cur, Want, DeltaSeconds, 6.f);
	OverviewCamera->SetWorldLocationAndRotation(T.TransformPosition(Loc), T.TransformRotation((ScanBounds.GetCenter() - Loc).Rotation().Quaternion()));
}

void APhoneTwinScanActor::SetView(EPhoneTwinView NewView)
{
	View = NewView;
	bFollowTracker = View == EPhoneTwinView::Tracker;
	TrackerCamera->SetActive(View == EPhoneTwinView::Tracker);
	OverviewCamera->SetActive(View == EPhoneTwinView::Overview);
	APlayerController* PC = GetWorld() ? GetWorld()->GetFirstPlayerController() : nullptr; if (!PC) return;
	AActor* Target = View == EPhoneTwinView::Player ? (AActor*)PC->GetPawn() : (AActor*)this;
	if (Target) PC->SetViewTargetWithBlend(Target, .35f);
}

void APhoneTwinScanActor::CycleView()
{
	SetView(View == EPhoneTwinView::Overview ? EPhoneTwinView::Tracker : View == EPhoneTwinView::Tracker ? EPhoneTwinView::Player : EPhoneTwinView::Overview);
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
	SetView(bFollow ? EPhoneTwinView::Tracker : StartView == EPhoneTwinView::Tracker ? EPhoneTwinView::Overview : StartView);
}

void APhoneTwinScanActor::SetHideLevelGeometry(bool bHide)
{
	bHideLevelGeometry = bHide;
	for (TWeakObjectPtr<AActor>& A : HiddenActors) if (A.IsValid()) A->SetActorHiddenInGame(false);
	HiddenActors.Reset();
	for (TWeakObjectPtr<AActor>& A : DisabledVolumes) if (APostProcessVolume* V = Cast<APostProcessVolume>(A.Get())) V->bEnabled = true;
	DisabledVolumes.Reset();
	if (bHide) HideOthers();
}

void APhoneTwinScanActor::HideOthers()
{
	// everything but the scan: meshes, sky, fog, lights, the level's character (also ones spawned after Play started)
	if (!GetWorld()) return;
	for (TActorIterator<AActor> It(GetWorld()); It; ++It)
	{
		AActor* A = *It;
		if (A == this) continue;
		if (APostProcessVolume* V = Cast<APostProcessVolume>(A)) { if (V->bEnabled) { V->bEnabled = false; DisabledVolumes.Add(V); } continue; }
		if (A->IsHidden()) continue;
		A->SetActorHiddenInGame(true); HiddenActors.Add(A);
	}
}

void APhoneTwinScanActor::ApplyLook()
{
	// points as light on a dark background: emissive gain above 1 + bloom, fixed exposure so the darkness does not get brightened
	if (Cloud) { Cloud->Gain = FVector4(1, 1, 1, bLightUp ? LightGain : 1.f); Cloud->ApplyRenderingParameters(); }
	for (UCameraComponent* C : {TrackerCamera.Get(), OverviewCamera.Get()})
	{
		if (!C) continue;
		FPostProcessSettings& S = C->PostProcessSettings; C->PostProcessBlendWeight = 1;
		S.bOverride_AutoExposureMethod = true; S.AutoExposureMethod = AEM_Manual;
		S.bOverride_AutoExposureApplyPhysicalCameraExposure = true; S.AutoExposureApplyPhysicalCameraExposure = false;
		S.bOverride_AutoExposureBias = true; S.AutoExposureBias = 0;
		S.bOverride_BloomIntensity = true; S.BloomIntensity = BloomIntensity;
		S.bOverride_BloomThreshold = true; S.BloomThreshold = .9f;
		S.bOverride_VignetteIntensity = true; S.VignetteIntensity = .55f;
	}
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
	if (!RelayStatus.IsEmpty())
	{
		TArray<double> R = RelayRtt; R.Sort();
		S += TEXT("\n릴레이: ") + RelayStatus;
		if (!RelayPeers.IsEmpty()) S += TEXT(" · ") + RelayPeers;
		if (R.Num()) S += FString::Printf(TEXT(" · 왕복 %.0f ms"), R[R.Num() / 2]);
	}
	if (!IsStarted()) S += TEXT("\n대기 중 — 휴대폰에서 '걷기 테스트 시작'을 누르면 진동·소리가 시작됩니다");
	else if (!bTracking) S += TEXT("\n추적 대기 중 — 선택한 장치에서 신호가 오면 시작합니다");
	else if (DistanceCm < 0) S += FString::Printf(TEXT("\n범위 밖 (%.0f cm 이내에 반응)"), ReactRange);
	else S += FString::Printf(TEXT("\n%s %s  %.1f cm  · 세기 %d%%"), bContact ? TEXT("▶ 접촉") : TEXT("근접"), *ObjectName, DistanceCm, FMath::RoundToInt(Intensity * 100));
	if (!SoundNow.IsEmpty()) S += TEXT("\n♪ ") + SoundNow;
	S += FString::Printf(TEXT("\n스캔: %s"), *ScanStatus);
	if (!CollisionStatus.IsEmpty()) S += TEXT("\n콜리전: ") + CollisionStatus;
	S += bLightUp ? FString::Printf(TEXT("\n점구름: 빛 · 관객 %.0f cm 안이 가장 밝고 %.0f cm 밖은 어둡게 [K]"), LitRadius, FadeRadius) : FString(TEXT("\n점구름: 원본 색 [K]"));
	if (bHideLevelGeometry) S += TEXT(" · 점구름만 [H]");
	S += FString::Printf(TEXT("\n보기: %s · 점 크기 %.2f%s"), View == EPhoneTwinView::Overview ? TEXT("전체 (멀리서)") : View == EPhoneTwinView::Tracker ? TEXT("장치 시점") : TEXT("레벨 캐릭터"),
		PointSize, bSendOsc ? *FString::Printf(TEXT(" · OSC → %s:%d"), *OscAddress, OscPort) : TEXT(""));
	if (!PhoneScanId.IsEmpty() && !LoadedScanId.IsEmpty() && PhoneScanId != LoadedScanId && Now - Phone.LastTime < 2)
		S += FString::Printf(TEXT("\n⚠ 휴대폰은 다른 스캔(%s)을 쓰고 있습니다"), *PhoneScanId);
	S += TEXT("\nGitHub: ") + FPhoneTwinSync::Get().GetStatus();
	return S;
}

// ------------------------------------------------------------------------------------------------ scans
void APhoneTwinScanActor::LoadNextScan()
{
	const TArray<FPhoneTwinLocalScan> L = FPhoneTwinSync::LocalScans();
	if (L.Num() == 0) { ScanStatus = TEXT("ARKO_PROJECT/PhoneTwinScans 에 스캔이 없습니다"); return; }
	int32 i = L.IndexOfByPredicate([this](const FPhoneTwinLocalScan& S) { return S.Id == LoadedScanId; });
	ScanId = L[(i + 1) % L.Num()].Id;
	LoadScan(ScanId);
}

void APhoneTwinScanActor::LoadScan(const FString& Id)
{
	if (bLoading) return;
	const TArray<FPhoneTwinLocalScan> L = FPhoneTwinSync::LocalScans();
	const FPhoneTwinLocalScan* Scan = Id.IsEmpty() ? (L.Num() ? &L[0] : nullptr) : L.FindByPredicate([&Id](const FPhoneTwinLocalScan& S) { return S.Id == Id; });
	if (!Scan) { ScanStatus = Id.IsEmpty() ? TEXT("ARKO_PROJECT/PhoneTwinScans 에 스캔이 없습니다 (GitHub 동기화 대기)") : FString::Printf(TEXT("%s 없음"), *Id); return; }
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
		R->Bounds = RobustBounds(UE);
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
	StaticCloud = PC;
	LightBase = MakeShared<TArray<FLidarPointCloudPoint>>(MoveTemp(Data->Points));   // light frames are made from these
	LightGen++; LightTimer = 1e9;
	Cloud->SetPointCloud(PC);
	Cloud->ScalingMethod = PointScaling;
	Cloud->SetPointShape(bRoundPoints ? ELidarPointCloudSpriteShape::Circle : ELidarPointCloudSpriteShape::Square);
	SetPointSize(PointSize);
	ApplyLook();
	if (Data->Bounds.IsValid) ScanBounds = Data->Bounds;

	LoadedMeta = Meta; LoadedScanId = Id;
	RebuildObjects();
	ScanStatus = FString::Printf(TEXT("%s · %s점 · 사물 %d%s%s"), *Id, *FText::AsNumber(PointCount).ToString(), Objects.Num(),
		Frame.bAligned ? TEXT(" · A·B 정렬") : TEXT(" · A·B 없음(스캔 원점 기준)"), Error.IsEmpty() ? TEXT("") : *(TEXT(" · 경고: ") + Error));
	UE_LOG(LogPhoneTwin, Log, TEXT("loaded %s"), *ScanStatus);
}

void APhoneTwinScanActor::RebuildObjects()
{
	// objects + their sounds. The collision file made in editor.html wins over the spheres of the scan's meta.
	for (FObjSound& Old : Sounds)
		for (UAudioComponent* A : {Old.Near, Old.Calm, Old.TouchComp})
			if (A && ObjectAudio.Remove(A) > 0) A->DestroyComponent();
	Sounds.Reset(); Objects.Reset(); UserSounds.Reset();

	const FString File = UPhoneTwinSettings::ScanDir() / TEXT("collisions") / (LoadedScanId + TEXT(".json"));
	CollisionStamp = IFileManager::Get().GetTimeStamp(*File);
	TArray<PhoneTwin::FScanObject> Shapes; FString Json;
	const bool bFile = FFileHelper::LoadFileToString(Json, *File) && PhoneTwin::ParseCollisions(Json, Shapes);
	int32 WithSound = 0;
	for (const PhoneTwin::FScanObject& O : bFile ? Shapes : LoadedMeta.Objects)
	{
		FObjectUE U;
		U.Id = O.Id; U.Label = O.Label; U.Name = O.Name.IsEmpty() ? O.Label : O.Name; U.C = Frame.Point(O.C); U.R = O.R * 100.0; U.bAi = O.bAi;
		U.CellR = O.Voxel * 50.0; U.Volume = O.Volume; U.bMuted = O.bMuted;
		U.FullCm = O.FullDistance < 0 ? -1.f : O.FullDistance * 100.f; U.MaxCm = O.MaxDistance < 0 ? -1.f : O.MaxDistance * 100.f;
		U.Cells.Reserve(O.Cells.Num());
		for (const FVector3f& C : O.Cells) U.Cells.Add(Frame.Point(C));
		USoundBase* Snd = LoadUserSound(O.NearSound, true);
		if (Snd || !O.TouchSound.IsEmpty()) WithSound++;
		if (!Snd) if (const TObjectPtr<USoundBase>* Found = ObjectSounds.Find(O.Label)) Snd = *Found;
		if (!Snd) if (const TObjectPtr<USoundBase>* Found = ObjectSounds.Find(O.Name)) Snd = *Found;
		if (!Snd) Snd = DefaultObjectSound;
		FObjSound S = MakeObjSound(O.Label, U.Name, U.C, Snd, O.TouchSound);
		S.Volume = O.Volume;
		Objects.Add(MoveTemp(U)); Sounds.Add(S);
	}
	CollisionStatus = bFile ? FString::Printf(TEXT("실제 형태 %d개 · 소리 지정 %d개 [B 보기]"), Objects.Num(), WithSound)
		: FString::Printf(TEXT("구 모양 %d개 (콜리전_편집기.bat을 실행하면 실제 형태가 만들어집니다)"), Objects.Num());
	UE_LOG(LogPhoneTwin, Log, TEXT("collisions of %s: %s"), *LoadedScanId, *CollisionStatus);
}

void APhoneTwinScanActor::TickCollisionFile(float DeltaSeconds)
{
	// the editor's Save reaches a running game within a second
	if (LoadedScanId.IsEmpty() || (CollisionTimer += DeltaSeconds) < 1.0) return;
	CollisionTimer = 0;
	if (bTrace && bTracking)
		for (int32 i = 0; i < Objects.Num() && i < Sounds.Num(); i++)
			UE_LOG(LogPhoneTwin, Log, TEXT("trace %s: floor %.1f cm, hand %.1f cm, gain %.3f, near %s"), *Objects[i].Name, Objects[i].FloorD, Objects[i].HandD, Sounds[i].Gain,
				Sounds[i].Near && Sounds[i].Near != Sounds[i].Calm ? (Sounds[i].Near->IsPlaying() ? TEXT("file playing") : TEXT("file stopped")) : TEXT("calm"));
	const FString File = UPhoneTwinSettings::ScanDir() / TEXT("collisions") / (LoadedScanId + TEXT(".json"));
	if (IFileManager::Get().GetTimeStamp(*File) != CollisionStamp) RebuildObjects();
}
