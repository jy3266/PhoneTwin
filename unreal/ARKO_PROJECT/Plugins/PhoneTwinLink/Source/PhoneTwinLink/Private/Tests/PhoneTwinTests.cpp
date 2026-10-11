#include "Misc/AutomationTest.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "HAL/FileManager.h"
#include "PhoneTwinCore.h"

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
	TestFalse(TEXT("short PTP1"), ParsePTP(TEXT("PTP1,1,1,0,0"), P));
	FEspPose E;
	TestTrue(TEXT("PTE1"), ParsePTE(TEXT("PTE1,7,1,1.25,-0.5,1.1,90,-10,5"), E));
	TestEqual(TEXT("esp yaw"), E.Yaw, 90.0); TestEqual(TEXT("esp y"), E.Y, -0.5);
	TestFalse(TEXT("other tag"), ParsePTE(TEXT("PTH1,7,1,1,1,1,1,1,1"), E));
	TestEqual(TEXT("PTH1"), MakePTH(9, true, .5f, false, 0, 12.34), FString(TEXT("PTH1,9,1,128,0,0,123\n")));
	TestEqual(TEXT("PTH1 out of range"), MakePTH(10, true, 0, false, -1, 1e9), FString(TEXT("PTH1,10,1,0,0,-1,-1\n")));
	TestEqual(TEXT("PTH1 invalid"), MakePTH(11, false, 1, true, 3, 5), FString(TEXT("PTH1,11,0,255,1,3,-1\n")));

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
#endif
