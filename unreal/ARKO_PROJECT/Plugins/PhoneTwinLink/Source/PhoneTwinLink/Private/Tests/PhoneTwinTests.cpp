#include "Misc/AutomationTest.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "HAL/FileManager.h"
#include "PhoneTwinCore.h"
#include "PhoneTwinCloud.h"
#include "PhoneTwinCalmSound.h"

#if WITH_DEV_AUTOMATION_TESTS
using namespace PhoneTwin;

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FPhoneTwinPlyTest, "PhoneTwin.Ply", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FPhoneTwinPlyTest::RunTest(const FString&)
{
	const FString Path = FPaths::ProjectSavedDir() / TEXT("PhoneTwinTest.ply");
	TArray<FVector3f> S = { {0, 0, 0}, {1.5f, -2.25f, 3.f}, {-0.125f, 4.f, 0.5f} };
	TArray<FColor> C = { FColor(255, 0, 0), FColor(0, 255, 0), FColor(1, 2, 3) };
	TestTrue(TEXT("save"), SavePly(Path, S, C));
	TArray<FVector3f> S2; TArray<FColor> C2; FString Err;
	TestTrue(TEXT("load binary"), LoadPly(Path, S2, C2, Err));
	TestEqual(TEXT("count"), S2.Num(), 3);
	if (S2.Num() == 3) { TestEqual(TEXT("xyz"), S2[1], S[1]); TestEqual(TEXT("rgb"), C2[2], C[2]); }

	const FString Ascii = FPaths::ProjectSavedDir() / TEXT("PhoneTwinTestAscii.ply");
	FFileHelper::SaveStringToFile(TEXT("ply\nformat ascii 1.0\nelement vertex 2\nproperty double x\nproperty double y\nproperty double z\nproperty float red\nproperty float green\nproperty float blue\nelement face 0\nproperty list uchar int vertex_indices\nend_header\n1 2 3 1 0 0\n-1 -2 -3 0 0.5 1\n"), *Ascii);
	TestTrue(TEXT("load ascii"), LoadPly(Ascii, S2, C2, Err));
	if (S2.Num() == 2) { TestEqual(TEXT("ascii xyz"), S2[1], FVector3f(-1, -2, -3)); TestEqual(TEXT("float colour"), (int32)C2[1].G, 127); }
	TestFalse(TEXT("reject missing"), LoadPly(FPaths::ProjectSavedDir() / TEXT("does_not_exist.ply"), S2, C2, Err));
	IFileManager::Get().Delete(*Path); IFileManager::Get().Delete(*Ascii);
	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FPhoneTwinFrameTest, "PhoneTwin.Frames", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FPhoneTwinFrameTest::RunTest(const FString&)
{
	// S: Y up. A on the floor at (1, 0, 2), B 3 m away along S -z.
	FScanMeta M; M.bHasAB = true; M.A = FVector3f(1, 0, 2); M.B = FVector3f(1, 0, -1);
	const FScanFrame F = FScanFrame::FromMeta(M);
	TestTrue(TEXT("aligned"), F.bAligned);
	TestTrue(TEXT("A -> origin"), F.Point(M.A).Equals(FVector::ZeroVector, 1e-3));
	TestTrue(TEXT("B -> +X 300cm"), F.Point(M.B).Equals(FVector(300, 0, 0), 1e-3));
	TestTrue(TEXT("up stays up"), F.Point(FVector3f(1, 1.5f, 2)).Equals(FVector(0, 0, 150), 1e-3));
	// Heading -z in S (right-handed, Y up), "left" is -x. It must land on Unreal -Y, like the ESP32 room frame's +Y.
	TestTrue(TEXT("left is -Y"), F.Point(FVector3f(0, 0, 2)).Equals(FVector(0, -100, 0), 1e-3));
	TestTrue(TEXT("room left is -Y"), RoomToUnreal(0, 1, 0).Equals(FVector(0, -100, 0)));
	TestTrue(TEXT("dir"), F.Dir(FVector3f(0, 0, -1)).Equals(FVector(1, 0, 0), 1e-6));
	TestEqual(TEXT("room yaw ccw -> unreal yaw"), RoomRotToUnreal(90, 0, 0).Yaw, -90.0);
	FScanMeta None; TestFalse(TEXT("no AB"), FScanFrame::FromMeta(None).bAligned);
	TestTrue(TEXT("raw mapping"), FScanFrame().Point(FVector3f(1, 2, 3)).Equals(FVector(100, 300, 200)));
	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FPhoneTwinGridTest, "PhoneTwin.Grid", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FPhoneTwinGridTest::RunTest(const FString&)
{
	TArray<FVector> P;
	for (int32 x = 0; x < 200; x++) for (int32 y = 0; y < 200; y++) P.Add(FVector(x, y, 0));        // floor 2x2 m, 1 cm spacing
	for (int32 y = 0; y < 200; y++) for (int32 z = 0; z < 200; z++) P.Add(FVector(150, y, z));      // wall at x = 150
	FPointGrid G; G.Build(P, 3.0);
	TestTrue(TEXT("dedup"), G.Num() < P.Num());
	FVector Hit;
	const double D = G.Nearest(FVector(130, 100, 100), 30, 10, Hit);
	TestTrue(TEXT("wall distance ~20cm"), FMath::Abs(D - 20) < 2.5);
	TestTrue(TEXT("hit on wall"), FMath::Abs(Hit.X - 150) < 1e-3);
	TestTrue(TEXT("out of range"), G.Nearest(FVector(50, 100, 100), 30, 10, Hit) > 1e6);
	TestTrue(TEXT("floor ignored"), G.Nearest(FVector(50, 100, 5), 30, 10, Hit) > 1e6);
	TestTrue(TEXT("floor counted"), G.Nearest(FVector(50, 100, 5), 30, -1, Hit) < 6);
	TestTrue(TEXT("long range"), FMath::Abs(G.Nearest(FVector(50, 100, 100), 150, 10, Hit) - 100) < 2.5);
	TestTrue(TEXT("floor estimate"), FMath::Abs(EstimateFloorZ(P)) < 2.5);
	TestEqual(TEXT("intensity far"), Intensity(30, 30, 3), 0.f);
	TestEqual(TEXT("intensity contact"), Intensity(2, 30, 3), 1.f);
	TestTrue(TEXT("intensity mid"), FMath::Abs(Intensity(16.5, 30, 3) - .5f) < 1e-3);
	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FPhoneTwinPacketTest, "PhoneTwin.Packets", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FPhoneTwinPacketTest::RunTest(const FString&)
{
	FPhonePose P;
	TestTrue(TEXT("PTP1"), ParsePTP(TEXT("PTP1,42,1,0.5,1.2,-3,0,0,-1,0,1,0,phone_scan_20261011_1530\n"), P));
	TestEqual(TEXT("seq"), P.Seq, 42u); TestTrue(TEXT("valid"), P.bValid);
	TestEqual(TEXT("pos"), P.P, FVector3f(.5f, 1.2f, -3)); TestEqual(TEXT("scan"), P.ScanId, FString(TEXT("phone_scan_20261011_1530")));
	TestTrue(TEXT("old PTP1: walk follows valid"), P.bWalk);
	TestTrue(TEXT("PTP1 walk=0"), ParsePTP(TEXT("PTP1,43,1,0,0,0,0,0,-1,0,1,0,s,0"), P) && P.bValid && !P.bWalk);
	TestTrue(TEXT("PTP1 walk=1"), ParsePTP(TEXT("PTP1,44,1,0,0,0,0,0,-1,0,1,0,s,1"), P) && P.bWalk);
	TestFalse(TEXT("short PTP1"), ParsePTP(TEXT("PTP1,1,1,0,0"), P));
	FEspPose E;
	TestTrue(TEXT("PTE1"), ParsePTE(TEXT("PTE1,7,1,1.25,-0.5,1.1,90,-10,5"), E));
	TestEqual(TEXT("esp yaw"), E.Yaw, 90.0); TestEqual(TEXT("esp y"), E.Y, -0.5);
	TestFalse(TEXT("other tag"), ParsePTE(TEXT("PTH1,7,1,1,1,1,1,1,1"), E));
	TestEqual(TEXT("PTH1"), MakePTH(9, true, .5f, false, 0, 12.34), FString(TEXT("PTH1,9,1,128,0,0,123\n")));
	TestEqual(TEXT("PTH1 out of range"), MakePTH(10, true, 0, false, -1, 1e9), FString(TEXT("PTH1,10,1,0,0,-1,-1\n")));
	TestEqual(TEXT("PTH1 invalid"), MakePTH(11, false, 1, true, 3, 5), FString(TEXT("PTH1,11,0,255,1,3,-1\n")));
	TestEqual(TEXT("PTU1"), MakePTU(12, true, TEXT("esp32"), FVector(1.5, -0.25, 1.2), 90, 3, 12.34, .5f), FString(TEXT("PTU1,12,1,esp32,1.500,-0.250,1.200,90.0,3,123,128\n")));
	TestEqual(TEXT("PTU1 out of range"), MakePTU(13, true, TEXT("phone"), FVector::ZeroVector, 0, -1, -1, 0), FString(TEXT("PTU1,13,1,phone,0.000,0.000,0.000,0.0,-1,-1,0\n")));

	// OSC: "/a" + ",ifs" + int 1 + float 1.0 + "hi" — every part padded to 4 bytes, big-endian numbers
	const TArray<uint8> Osc = FOscMessage(TEXT("/a")).Int(1).Float(1.f).Str(TEXT("hi")).Encode();
	const uint8 Want[] = { '/', 'a', 0, 0, ',', 'i', 'f', 's', 0, 0, 0, 0, 0, 0, 0, 1, 0x3f, 0x80, 0, 0, 'h', 'i', 0, 0 };
	TestEqual(TEXT("osc size"), Osc.Num(), (int32)sizeof(Want));
	TestTrue(TEXT("osc bytes"), Osc.Num() == sizeof(Want) && FMemory::Memcmp(Osc.GetData(), Want, sizeof(Want)) == 0);
	TestEqual(TEXT("osc 4-byte string gets 4 zeros"), FOscMessage(TEXT("/abc")).Encode().Num(), 8 + 4);

	FScanMeta M;
	TestTrue(TEXT("meta"), ParseMeta(TEXT("{\"id\":\"s1\",\"a\":[0,0,0],\"b\":[2,0,0],\"objects\":[{\"id\":3,\"name\":\"사물 3\",\"c\":[1,1,1],\"r\":0.2}],\"ai\":[{\"label\":\"chair\",\"name\":\"의자\",\"c\":[0,0.4,1],\"r\":0.35}]}"), M));
	TestTrue(TEXT("meta ab"), M.bHasAB);
	TestEqual(TEXT("meta objects"), M.Objects.Num(), 2);
	if (M.Objects.Num() == 2) { TestEqual(TEXT("placed id"), M.Objects[0].Id, 3); TestEqual(TEXT("ai id"), M.Objects[1].Id, 100); TestEqual(TEXT("ai name"), M.Objects[1].Name, FString(TEXT("의자"))); }
	TestTrue(TEXT("meta null ab"), ParseMeta(TEXT("{\"id\":\"s2\",\"a\":null,\"b\":null}"), M) && !M.bHasAB);
	TArray<FScanEntry> L;
	TestTrue(TEXT("index"), ParseIndex(TEXT("{\"version\":1,\"scans\":[{\"id\":\"a\",\"points\":5},{\"id\":\"../evil\"}]}"), L));
	TestEqual(TEXT("index filters bad ids"), L.Num(), 1);
	if (L.Num() == 1) TestEqual(TEXT("default ply path"), L[0].Ply, FString(TEXT("scans/a.ply")));
	return true;
}
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FPhoneTwinCalmTest, "PhoneTwin.CalmSound", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FPhoneTwinCalmTest::RunTest(const FString&)
{
	// every AI label gets its own voice; unknown labels still get a pentatonic singing bowl
	TestTrue(TEXT("cup voice"), CalmVoiceFor(TEXT("cup")).Idea.Contains(TEXT("싱잉볼")));
	TestTrue(TEXT("keyboard rains"), CalmVoiceFor(TEXT("Keyboard")).Drops > 0);
	TestTrue(TEXT("unknown label"), CalmVoiceFor(TEXT("zebra")).PadHz > 0);
	TestNotEqual(TEXT("cup and book differ"), CalmVoiceFor(TEXT("cup")).BellHz, CalmVoiceFor(TEXT("book")).BellHz);

	FCalmSynth S; S.Init(CalmVoiceFor(TEXT("tv")), 48000);
	TArray<float> B; B.SetNumZeroed(4800);
	S.Render(B.GetData(), B.Num());
	TestTrue(TEXT("silent when far"), S.Peak() < 1e-4f);
	S.SetNear(1); for (int32 i = 0; i < 20; i++) S.Render(B.GetData(), B.Num());   // 2 s: the pad has glided in
	const float Pad = S.Peak();
	TestTrue(TEXT("pad sounds when near"), Pad > .03f);
	TestTrue(TEXT("pad stays soft"), Pad < .6f);
	S.SetNear(0); for (int32 i = 0; i < 80; i++) S.Render(B.GetData(), B.Num());
	TestTrue(TEXT("pad fades away"), S.Peak() < .01f);
	S.Touch(1); S.Render(B.GetData(), B.Num());
	TestTrue(TEXT("chime rings on touch"), S.Peak() > .03f);
	bool bFinite = true; for (float X : B) bFinite &= FMath::IsFinite(X) && FMath::Abs(X) <= 1.f;
	TestTrue(TEXT("no overload"), bFinite);
	for (int32 i = 0; i < 120; i++) S.Render(B.GetData(), B.Num());
	TestTrue(TEXT("chime decays"), S.Peak() < .01f);
	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FPhoneTwinGlowTest, "PhoneTwin.Glow", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FPhoneTwinGlowTest::RunTest(const FString&)
{
	FGlowParams P;   // brightest within 120 cm, dim beyond 450 cm
	TestEqual(TEXT("bright at the audience"), GlowBrightness(P, 0), P.NearBrightness);
	TestEqual(TEXT("dim far away"), GlowBrightness(P, 1000), P.FarBrightness);
	const float Mid = GlowBrightness(P, 285);
	TestTrue(TEXT("fades in between"), Mid > P.FarBrightness && Mid < P.NearBrightness);
	P.Reveal = 0;
	TestEqual(TEXT("idle brightness without audience"), GlowBrightness(P, 0), P.IdleBrightness);
	P.Reveal = 1;

	TArray<FLidarPointCloudPoint> Base, Out;
	for (int32 i = 0; i < 2000; i++) Base.Emplace(FVector3f(i < 1000 ? 10.f : 900.f, (float)(i % 100), 50.f), FColor(200, 60, 40), true, (uint8)0);
	BuildGlow(Base, P, FVector3f(0, 0, 0), 3.0, Out);
	TestEqual(TEXT("every point kept"), Out.Num(), 2000);
	int32 Moved = 0; double NearR = 0, FarR = 0;
	for (int32 i = 0; i < Out.Num(); i++)
	{
		Moved += Out[i].Location != Base[i].Location ? 1 : 0;
		(i < 1000 ? NearR : FarR) += Out[i].Color.R;
	}
	TestEqual(TEXT("points stay in place"), Moved, 0);
	TestTrue(TEXT("near points brighter than far ones"), NearR > FarR * 2.5);
	P.MaxPoints = 500; BuildGlow(Base, P, FVector3f(0, 0, 0), 3.0, Out);
	TestTrue(TEXT("point budget"), Out.Num() <= 650);
	return true;
}
#endif

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FPhoneTwinCollisionTest, "PhoneTwin.Collisions", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FPhoneTwinCollisionTest::RunTest(const FString&)
{
	using namespace PhoneTwin;
	TArray<FScanObject> O;
	TestTrue(TEXT("parse"), ParseCollisions(TEXT("{\"voxel\":0.1,\"collisions\":[{\"id\":100,\"label\":\"chair\",\"name\":\"의자\",\"source\":\"ai\",\"cells\":[0,0,0,2,0,0],\"nearSound\":\"rain.wav\",\"touchSound\":\"/Game/Bell\",\"volume\":0.5,\"fullDistance\":0.3,\"maxDistance\":2,\"muted\":true},{\"id\":200,\"label\":\"x\",\"cells\":[]}]}"), O));
	TestEqual(TEXT("empty shape dropped"), O.Num(), 1);
	if (O.Num() == 1)
	{
		TestEqual(TEXT("cells"), O[0].Cells.Num(), 2);
		TestTrue(TEXT("cell centre"), O[0].Cells[1].Equals(FVector3f(.25f, .05f, .05f), 1e-4f));
		TestTrue(TEXT("centre between cells"), O[0].C.Equals(FVector3f(.15f, .05f, .05f), 1e-4f));
		TestEqual(TEXT("sound"), O[0].NearSound, FString(TEXT("rain.wav")));
		TestEqual(TEXT("touch"), O[0].TouchSound, FString(TEXT("/Game/Bell")));
		TestEqual(TEXT("max"), O[0].MaxDistance, 2.f);
		TestTrue(TEXT("muted, ai"), O[0].bMuted && O[0].bAi);
	}
	// 2 stereo frames at 48 kHz, with an unrelated chunk before the data
	const uint8 W[] = { 'R','I','F','F',0,0,0,0,'W','A','V','E','f','m','t',' ',16,0,0,0, 1,0, 2,0, 0x80,0xBB,0,0, 0,0xEE,2,0, 4,0, 16,0,
		'L','I','S','T',3,0,0,0, 1,2,3,0, 'd','a','t','a',8,0,0,0, 1,0, 2,0, 0xFF,0xFF, 4,0 };
	TArray<int16> Pcm; int32 Rate = 0, Ch = 0; FString Err;
	TArray<uint8> Bytes(W, UE_ARRAY_COUNT(W));
	TestTrue(TEXT("wav"), ParseWav(Bytes, Pcm, Rate, Ch, Err));
	TestEqual(TEXT("wav rate"), Rate, 48000); TestEqual(TEXT("wav channels"), Ch, 2);
	TestEqual(TEXT("wav samples"), Pcm.Num(), 4);
	if (Pcm.Num() == 4) TestEqual(TEXT("wav negative"), (int32)Pcm[2], -1);
	// playback: 4 samples long, stereo; looping wraps around, a one-shot is silent until Restart and silent again after its end
	const FString WavPath = FPaths::CreateTempFilename(*FPaths::ProjectIntermediateDir(), TEXT("pt"), TEXT(".wav"));
	FFileHelper::SaveArrayToFile(Bytes, *WavPath);
	TArray<uint8> Out; const int16* S;
	UPhoneTwinFileWave* Loop = NewObject<UPhoneTwinFileWave>();
	TestTrue(TEXT("load"), Loop->LoadFile(WavPath, true, Err));
	Loop->OnGeneratePCMAudio(Out, 6); S = (const int16*)Out.GetData();
	TestEqual(TEXT("loop wraps"), (int32)S[4], 1);
	UPhoneTwinFileWave* Once = NewObject<UPhoneTwinFileWave>();
	Once->LoadFile(WavPath, false, Err);
	Once->OnGeneratePCMAudio(Out, 2); S = (const int16*)Out.GetData();
	TestEqual(TEXT("silent before restart"), (int32)S[0], 0);
	Once->Restart();
	Once->OnGeneratePCMAudio(Out, 6); S = (const int16*)Out.GetData();
	TestEqual(TEXT("plays after restart"), (int32)S[1], 2);
	TestEqual(TEXT("silent at the end"), (int32)S[4], 0);
	IFileManager::Get().Delete(*WavPath);
	Bytes[34] = 24;
	TestFalse(TEXT("24-bit refused"), ParseWav(Bytes, Pcm, Rate, Ch, Err));
	return true;
}
