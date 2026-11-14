// The start screen of the packaged game (see PhoneTwinSetup.h). Plain Slate with the core style: no assets needed.
#include "PhoneTwinSetup.h"
#include "Widgets/SCompoundWidget.h"
#include "Widgets/DeclarativeSyntaxSupport.h"
#include "Widgets/SBoxPanel.h"
#include "Widgets/Layout/SBorder.h"
#include "Widgets/Layout/SBox.h"
#include "Widgets/Text/STextBlock.h"
#include "Widgets/Input/SButton.h"
#include "Widgets/Input/SCheckBox.h"
#include "Widgets/Input/SEditableTextBox.h"
#include "Styling/CoreStyle.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonWriter.h"
#include "Serialization/JsonSerializer.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"

// ------------------------------------------------------------------------------------------------ values
FString FPhoneTwinSetupValues::File()
{
	return FPaths::ConvertRelativePathToFull(FPaths::ProjectSavedDir() / TEXT("PhoneTwinSetup.json"));
}

bool FPhoneTwinSetupValues::Load()
{
	FString Text;
	if (!FFileHelper::LoadFileToString(Text, *File())) return false;
	TSharedPtr<FJsonObject> J;
	if (!FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Text), J) || !J.IsValid()) return false;
	J->TryGetNumberField(TEXT("source"), Source);
	J->TryGetStringField(TEXT("scan"), Scan);
	J->TryGetBoolField(TEXT("autoSync"), bAutoSync);
	J->TryGetBoolField(TEXT("relay"), bRelay);
	J->TryGetStringField(TEXT("relayRoom"), RelayRoom);
	J->TryGetStringField(TEXT("relayKey"), RelayKey);
	J->TryGetBoolField(TEXT("osc"), bOsc);
	J->TryGetStringField(TEXT("oscHost"), OscHost);
	J->TryGetNumberField(TEXT("oscPort"), OscPort);
	J->TryGetNumberField(TEXT("uwbPort"), UwbPort);
	J->TryGetStringField(TEXT("espAddress"), EspAddress);
	J->TryGetBoolField(TEXT("fullscreen"), bFullscreen);
	J->TryGetBoolField(TEXT("askAtStart"), bAskAtStart);
	return true;
}

bool FPhoneTwinSetupValues::Save() const
{
	TSharedRef<FJsonObject> J = MakeShared<FJsonObject>();
	J->SetNumberField(TEXT("source"), Source);
	J->SetStringField(TEXT("scan"), Scan);
	J->SetBoolField(TEXT("autoSync"), bAutoSync);
	J->SetBoolField(TEXT("relay"), bRelay);
	J->SetStringField(TEXT("relayRoom"), RelayRoom);
	J->SetStringField(TEXT("relayKey"), RelayKey);
	J->SetBoolField(TEXT("osc"), bOsc);
	J->SetStringField(TEXT("oscHost"), OscHost);
	J->SetNumberField(TEXT("oscPort"), OscPort);
	J->SetNumberField(TEXT("uwbPort"), UwbPort);
	J->SetStringField(TEXT("espAddress"), EspAddress);
	J->SetBoolField(TEXT("fullscreen"), bFullscreen);
	J->SetBoolField(TEXT("askAtStart"), bAskAtStart);
	FString Out;
	FJsonSerializer::Serialize(J, TJsonWriterFactory<>::Create(&Out));
	return FFileHelper::SaveStringToFile(Out, *File(), FFileHelper::EEncodingOptions::ForceUTF8WithoutBOM);
}

FString FPhoneTwinSetupValues::Problem() const
{
	auto BadPort = [](int32 P) { return P < 1 || P > 65535; };
	if (bRelay && RelayRoom.TrimStartAndEnd().IsEmpty()) return TEXT("릴레이 방 이름을 넣어 주세요 (보통 arko)");
	if (bOsc && OscHost.TrimStartAndEnd().IsEmpty()) return TEXT("TouchDesigner 주소를 넣어 주세요 (같은 PC면 127.0.0.1)");
	if (bOsc && BadPort(OscPort)) return TEXT("TouchDesigner 포트는 1~65535 사이 숫자입니다 (보통 7000)");
	if (UwbPort != 0 && BadPort(UwbPort)) return TEXT("UWB 수신 포트는 1~65535 사이 숫자입니다 (보통 8000, 끄려면 0)");
	if (UwbPort == 7777) return TEXT("UWB 수신 포트로 7777은 쓸 수 없습니다 (휴대폰이 쓰는 포트)");
	if (bOsc && OscPort == UwbPort && (OscHost == TEXT("127.0.0.1") || OscHost == TEXT("localhost"))) return TEXT("TouchDesigner 포트와 UWB 수신 포트가 같습니다");
	return FString();
}

// ------------------------------------------------------------------------------------------------ the screen
class SPhoneTwinSetup : public SCompoundWidget
{
public:
	SLATE_BEGIN_ARGS(SPhoneTwinSetup) {}
	SLATE_END_ARGS()

	FPhoneTwinSetupValues V;
	TArray<FString> Scans;
	bool bHasKey = false;
	TFunction<void(const FPhoneTwinSetupValues&)> OnStart;
	TFunction<void()> OnClose;
	TSharedPtr<SEditableTextBox> Room, Key, OscHost, OscPort, UwbPort, Esp;
	FString Message;

	void Construct(const FArguments&)
	{
		const FSlateFontInfo Title = FCoreStyle::GetDefaultFontStyle("Bold", 20), Body = FCoreStyle::GetDefaultFontStyle("Regular", 12),
			Small = FCoreStyle::GetDefaultFontStyle("Regular", 10), Head = FCoreStyle::GetDefaultFontStyle("Bold", 12);
		const FLinearColor Accent(.49f, .83f, .99f), Muted(.62f, .68f, .75f);

		auto Label = [&](const FString& S) { return SNew(SBox).WidthOverride(200).VAlign(VAlign_Center)[ SNew(STextBlock).Text(FText::FromString(S)).Font(Body).ColorAndOpacity(FLinearColor::White) ]; };
		auto Section = [&](const FString& S) { return SNew(STextBlock).Text(FText::FromString(S)).Font(Head).ColorAndOpacity(Accent); };
		auto Note = [&](const FString& S) { return SNew(STextBlock).Text(FText::FromString(S)).Font(Small).ColorAndOpacity(Muted).AutoWrapText(true); };
		auto Check = [&](bool* Ptr, const FString& S)
		{
			return SNew(SCheckBox)
				.IsChecked_Lambda([Ptr]() { return *Ptr ? ECheckBoxState::Checked : ECheckBoxState::Unchecked; })
				.OnCheckStateChanged_Lambda([Ptr](ECheckBoxState St) { *Ptr = St == ECheckBoxState::Checked; })
				[ SNew(STextBlock).Text(FText::FromString(S)).Font(Body).ColorAndOpacity(FLinearColor::White) ];
		};
		auto Radio = [&](int32 Value, const FString& S)
		{
			return SNew(SCheckBox).Style(FCoreStyle::Get(), "RadioButton")
				.IsChecked_Lambda([this, Value]() { return V.Source == Value ? ECheckBoxState::Checked : ECheckBoxState::Unchecked; })
				.OnCheckStateChanged_Lambda([this, Value](ECheckBoxState) { V.Source = Value; })
				[ SNew(STextBlock).Text(FText::FromString(S)).Font(Body).ColorAndOpacity(FLinearColor::White) ];
		};
		auto Box = [&](TSharedPtr<SEditableTextBox>& Out, const FString& Text, const FString& Hint, TFunction<bool()> Enabled, bool bPassword = false)
		{
			return SAssignNew(Out, SEditableTextBox).Text(FText::FromString(Text)).HintText(FText::FromString(Hint)).Font(Body).IsPassword(bPassword)
				.IsEnabled_Lambda([Enabled]() { return !Enabled || Enabled(); });
		};
		auto Row = [&](TSharedRef<SWidget> L, TSharedRef<SWidget> R)
		{
			return SNew(SHorizontalBox) + SHorizontalBox::Slot().AutoWidth()[ L ] + SHorizontalBox::Slot().FillWidth(1).VAlign(VAlign_Center)[ R ];
		};
		auto Button = [&](const FString& S, TFunction<void()> Fn, bool bPrimary)
		{
			return SNew(SButton).ContentPadding(FMargin(18, 8)).HAlign(HAlign_Center)
				.ButtonColorAndOpacity(bPrimary ? FLinearColor(.2f, .55f, .8f) : FLinearColor(.25f, .3f, .36f))
				.OnClicked_Lambda([Fn]() { Fn(); return FReply::Handled(); })
				[ SNew(STextBlock).Text(FText::FromString(S)).Font(Head).ColorAndOpacity(FLinearColor::White) ];
		};

		ChildSlot
		[
			SNew(SBorder).BorderImage(FCoreStyle::Get().GetBrush("WhiteBrush")).BorderBackgroundColor(FLinearColor(0, 0, 0, .6f))
			.HAlign(HAlign_Center).VAlign(VAlign_Center)
			[
				SNew(SBorder).BorderImage(FCoreStyle::Get().GetBrush("WhiteBrush")).BorderBackgroundColor(FLinearColor(.02f, .035f, .055f, .97f)).Padding(26)
				[
					SNew(SBox).WidthOverride(640)
					[
						SNew(SVerticalBox)
						+ SVerticalBox::Slot().AutoHeight()[ SNew(STextBlock).Text(FText::FromString(TEXT("PHONE TWIN  ·  시작 설정"))).Font(Title).ColorAndOpacity(Accent) ]
						+ SVerticalBox::Slot().AutoHeight().Padding(0, 4, 0, 14)[ Note(TEXT("현장에 맞게 확인하고 [시작]을 누르세요. 값은 기억되어 다음 실행 때 그대로 채워집니다. 실행 중에는 F6으로 다시 열 수 있습니다.")) ]

						+ SVerticalBox::Slot().AutoHeight().Padding(0, 4)[ Section(TEXT("관객 · 스캔")) ]
						+ SVerticalBox::Slot().AutoHeight().Padding(0, 4)[ Row(Label(TEXT("관객을 움직이는 장치")),
							SNew(SHorizontalBox) + SHorizontalBox::Slot().AutoWidth().Padding(0, 0, 18, 0)[ Radio(0, TEXT("휴대폰 앱")) ] + SHorizontalBox::Slot().AutoWidth()[ Radio(1, TEXT("UWB 태그 (라즈베리파이)")) ]) ]
						+ SVerticalBox::Slot().AutoHeight().Padding(0, 4)[ Row(Label(TEXT("보여 줄 스캔")),
							SNew(SHorizontalBox)
							+ SHorizontalBox::Slot().AutoWidth()[ Button(TEXT("< 이전"), [this]() { Step(-1); }, false) ]
							+ SHorizontalBox::Slot().FillWidth(1).VAlign(VAlign_Center).Padding(10, 0)[ SNew(STextBlock).Font(Body).ColorAndOpacity(FLinearColor::White).AutoWrapText(true)
								.Text_Lambda([this]() { return FText::FromString(ScanLabel()); }) ]
							+ SHorizontalBox::Slot().AutoWidth()[ Button(TEXT("다음 >"), [this]() { Step(1); }, false) ]) ]
						+ SVerticalBox::Slot().AutoHeight().Padding(200, 2, 0, 4)[ Check(&V.bAutoSync, TEXT("GitHub에 올라온 새 스캔 자동으로 받기")) ]

						+ SVerticalBox::Slot().AutoHeight().Padding(0, 12, 0, 4)[ Section(TEXT("인터넷 릴레이 (휴대폰 앱 · 웹 몰입 보기 · 체험자 흔적)")) ]
						+ SVerticalBox::Slot().AutoHeight().Padding(0, 4)[ Row(Label(TEXT("릴레이")), Check(&V.bRelay, TEXT("사용"))) ]
						+ SVerticalBox::Slot().AutoHeight().Padding(0, 4)[ Row(Label(TEXT("방 이름")), Box(Room, V.RelayRoom, TEXT("arko"), [this]() { return V.bRelay; })) ]
						+ SVerticalBox::Slot().AutoHeight().Padding(0, 4)[ Row(Label(TEXT("릴레이 키")), Box(Key, V.RelayKey, bHasKey ? TEXT("비워 두면 패키지에 든 키를 씁니다") : TEXT("서버의 RELAY_KEY"), [this]() { return V.bRelay; }, true)) ]

						+ SVerticalBox::Slot().AutoHeight().Padding(0, 12, 0, 4)[ Section(TEXT("TouchDesigner · UWB · 진동")) ]
						+ SVerticalBox::Slot().AutoHeight().Padding(0, 4)[ Row(Label(TEXT("TouchDesigner로 OSC")), Check(&V.bOsc, TEXT("보내기"))) ]
						+ SVerticalBox::Slot().AutoHeight().Padding(0, 4)[ Row(Label(TEXT("TouchDesigner 주소 · 포트")),
							SNew(SHorizontalBox)
							+ SHorizontalBox::Slot().FillWidth(1).Padding(0, 0, 8, 0)[ Box(OscHost, V.OscHost, TEXT("127.0.0.1 = 이 PC"), [this]() { return V.bOsc; }) ]
							+ SHorizontalBox::Slot().AutoWidth()[ SNew(SBox).WidthOverride(110)[ Box(OscPort, FString::FromInt(V.OscPort), TEXT("7000"), [this]() { return V.bOsc; }) ] ]) ]
						+ SVerticalBox::Slot().AutoHeight().Padding(0, 4)[ Row(Label(TEXT("UWB 게이트웨이 수신 포트")), Box(UwbPort, FString::FromInt(V.UwbPort), TEXT("8000 (끄려면 0)"), nullptr)) ]
						+ SVerticalBox::Slot().AutoHeight().Padding(0, 4)[ Row(Label(TEXT("진동 장치 IP")), Box(Esp, V.EspAddress, TEXT("비워 두면 신호를 보낸 장치로 자동"), nullptr)) ]

						+ SVerticalBox::Slot().AutoHeight().Padding(0, 12, 0, 4)[ Section(TEXT("화면")) ]
						+ SVerticalBox::Slot().AutoHeight().Padding(0, 3)[ Check(&V.bFullscreen, TEXT("전체 화면")) ]
						+ SVerticalBox::Slot().AutoHeight().Padding(0, 3)[ Check(&V.bAskAtStart, TEXT("다음 실행 때도 이 화면 보이기 (끄면 바로 시작, F6으로 다시 열기)")) ]

						+ SVerticalBox::Slot().AutoHeight().Padding(0, 14, 0, 0)
						[
							SNew(SHorizontalBox)
							+ SHorizontalBox::Slot().FillWidth(1).VAlign(VAlign_Center)[ SNew(STextBlock).Font(Body).ColorAndOpacity(FLinearColor(1, .55f, .45f)).AutoWrapText(true)
								.Text_Lambda([this]() { return FText::FromString(Message); }) ]
							+ SHorizontalBox::Slot().AutoWidth().Padding(8, 0, 0, 0)[ SNew(SBox).Visibility_Lambda([this]() { return OnClose ? EVisibility::Visible : EVisibility::Collapsed; })
								[ Button(TEXT("닫기"), [this]() { if (OnClose) OnClose(); }, false) ] ]
							+ SHorizontalBox::Slot().AutoWidth().Padding(8, 0, 0, 0)[ Button(TEXT("시작"), [this]() { Start(); }, true) ]
						]
					]
				]
			]
		];
	}

	virtual bool SupportsKeyboardFocus() const override { return true; }

	int32 ScanIndex() const { return V.Scan.IsEmpty() ? -1 : Scans.IndexOfByKey(V.Scan); }
	void Step(int32 D)
	{
		// -1 = automatic, then every scan on this PC
		const int32 N = Scans.Num() + 1;
		const int32 I = ((ScanIndex() + 1 + D) % N + N) % N - 1;
		V.Scan = I < 0 ? FString() : Scans[I];
	}
	FString ScanLabel() const
	{
		if (V.Scan.IsEmpty()) return FString::Printf(TEXT("자동 (편집기에서 마지막 저장 → 가장 최근) · 이 PC에 %d개"), Scans.Num());
		return ScanIndex() < 0 ? V.Scan + TEXT(" (이 PC에 없음 — GitHub에서 받으면 열림)") : V.Scan;
	}
	void Start()
	{
		auto Num = [](const TSharedPtr<SEditableTextBox>& B, int32 Bad) { const FString S = B->GetText().ToString().TrimStartAndEnd(); return S.IsNumeric() ? FCString::Atoi(*S) : Bad; };
		V.RelayRoom = Room->GetText().ToString().TrimStartAndEnd();
		V.RelayKey = Key->GetText().ToString().TrimStartAndEnd();
		V.OscHost = OscHost->GetText().ToString().TrimStartAndEnd();
		V.OscPort = Num(OscPort, -1);
		V.UwbPort = Num(UwbPort, -1);
		V.EspAddress = Esp->GetText().ToString().TrimStartAndEnd();
		Message = V.Problem();
		if (Message.IsEmpty() && OnStart) OnStart(V);
	}
};

TSharedRef<SWidget> MakePhoneTwinSetupWidget(const FPhoneTwinSetupValues& Init, const TArray<FString>& ScanIds, bool bHasBuiltInKey,
	TFunction<void(const FPhoneTwinSetupValues&)> OnStart, TFunction<void()> OnClose)
{
	TSharedRef<SPhoneTwinSetup> W = SNew(SPhoneTwinSetup);
	// the values must be in place before the rows read them: build again with them
	W->V = Init; W->Scans = ScanIds; W->bHasKey = bHasBuiltInKey; W->OnStart = MoveTemp(OnStart); W->OnClose = MoveTemp(OnClose);
	W->Construct(SPhoneTwinSetup::FArguments());
	return W;
}
