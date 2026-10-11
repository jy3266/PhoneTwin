// Editor side: keeps Content/PhoneTwinScans in sync with GitHub while the editor is open and turns every
// scan PLY there into a LiDAR Point Cloud asset (/Game/PhoneTwinScans/<id>_Cloud) you can drag into a level.
#include "Modules/ModuleManager.h"
#include "Containers/Ticker.h"
#include "HAL/IConsoleManager.h"
#include "HAL/FileManager.h"
#include "Misc/FileHelper.h"
#include "Misc/PackageName.h"
#include "AssetRegistry/AssetRegistryModule.h"
#include "UObject/Package.h"
#include "UObject/SavePackage.h"
#include "Editor.h"
#include "LidarPointCloud.h"
#include "PhoneTwinCloud.h"
#include "PhoneTwinSync.h"

DEFINE_LOG_CATEGORY_STATIC(LogPhoneTwinEditor, Log, All);

class FPhoneTwinLinkEditorModule : public IModuleInterface
{
public:
	virtual void StartupModule() override
	{
		SyncHandle = FPhoneTwinSync::Get().OnSynced.AddRaw(this, &FPhoneTwinLinkEditorModule::OnSynced);
		Ticker = FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateRaw(this, &FPhoneTwinLinkEditorModule::Tick), 5.f);
		Commands.Add(IConsoleManager::Get().RegisterConsoleCommand(TEXT("PhoneTwin.Sync"), TEXT("Download new scans from GitHub into Content/PhoneTwinScans"),
			FConsoleCommandDelegate::CreateLambda([]() { FPhoneTwinSync::Get().Run(); })));
		Commands.Add(IConsoleManager::Get().RegisterConsoleCommand(TEXT("PhoneTwin.ImportAll"), TEXT("Create/refresh point cloud assets for every PLY in Content/PhoneTwinScans"),
			FConsoleCommandDelegate::CreateLambda([this]() { ImportMissing(true); })));
	}
	virtual void ShutdownModule() override
	{
		FTSTicker::GetCoreTicker().RemoveTicker(Ticker);
		FPhoneTwinSync::Get().OnSynced.Remove(SyncHandle);
		for (IConsoleObject* C : Commands) IConsoleManager::Get().UnregisterConsoleObject(C);
	}

private:
	bool Tick(float)
	{
		if (IsRunningCommandlet() || !GEditor) return true;
		// skip while playing: the game actor syncs by itself and PIE should not hitch on asset saves
		if (GEditor->PlayWorld) return true;
		const UPhoneTwinSettings* S = GetDefault<UPhoneTwinSettings>();
		const double Now = FPlatformTime::Seconds();
		if (S->bAutoSyncInEditor && Now >= NextSync) { NextSync = Now + S->SyncIntervalSeconds; FPhoneTwinSync::Get().Run(); }
		if (Now >= NextScan) { NextScan = Now + 10; ImportMissing(false); }   // also picks up PLYs dropped in by hand or by tools/sync_scans.py
		return true;
	}

	void OnSynced(bool bNew, const FString&) { if (bNew && GEditor && !GEditor->PlayWorld) ImportMissing(false); }

	void ImportMissing(bool bForce)
	{
		if (!GetDefault<UPhoneTwinSettings>()->bCreatePointCloudAssets) return;
		for (const FPhoneTwinLocalScan& Scan : FPhoneTwinSync::LocalScans())
		{
			const FString Asset = SanitizeName(Scan.Id) + TEXT("_Cloud");
			const FString Package = TEXT("/Game/PhoneTwinScans/") + Asset;
			const FString File = FPackageName::LongPackageNameToFilename(Package, FPackageName::GetAssetPackageExtension());
			const FDateTime Source = FMath::Max(IFileManager::Get().GetTimeStamp(*Scan.PlyPath), Scan.MetaPath.IsEmpty() ? FDateTime::MinValue() : IFileManager::Get().GetTimeStamp(*Scan.MetaPath));
			if (!bForce && FPaths::FileExists(File) && IFileManager::Get().GetTimeStamp(*File) >= Source) continue;
			if (!bForce && Failed.Contains(Scan.PlyPath)) continue;
			if (!Import(Scan, Package, Asset, File)) Failed.Add(Scan.PlyPath);
		}
	}

	static FString SanitizeName(const FString& In)
	{
		FString Out; for (TCHAR C : In) Out.AppendChar(FChar::IsAlnum(C) || C == TEXT('_') ? C : TEXT('_'));
		return Out.IsEmpty() ? FString(TEXT("Scan")) : Out;
	}

	bool Import(const FPhoneTwinLocalScan& Scan, const FString& PackageName, const FString& AssetName, const FString& File)
	{
		TArray<FVector3f> S; TArray<FColor> C; FString Err;
		if (!PhoneTwin::LoadPly(Scan.PlyPath, S, C, Err)) { UE_LOG(LogPhoneTwinEditor, Warning, TEXT("%s: %s"), *Scan.PlyPath, *Err); return false; }
		PhoneTwin::FScanMeta Meta; FString J;
		if (!Scan.MetaPath.IsEmpty() && FFileHelper::LoadFileToString(J, *Scan.MetaPath)) PhoneTwin::ParseMeta(J, Meta);
		TArray<FLidarPointCloudPoint> Pts;
		PhoneTwin::ToCloudPoints(S, C, PhoneTwin::FScanFrame::FromMeta(Meta), Pts);

		UPackage* Pkg = CreatePackage(*PackageName);
		Pkg->FullyLoad();
		ULidarPointCloud* Cloud = FindObject<ULidarPointCloud>(Pkg, *AssetName);
		const bool bNew = Cloud == nullptr;
		if (bNew) Cloud = NewObject<ULidarPointCloud>(Pkg, *AssetName, RF_Public | RF_Standalone | RF_Transactional);
		if (!Cloud->SetData(Pts)) { UE_LOG(LogPhoneTwinEditor, Warning, TEXT("%s: SetData failed"), *AssetName); return false; }
		if (bNew) FAssetRegistryModule::AssetCreated(Cloud);
		Pkg->MarkPackageDirty();
		FSavePackageArgs Args; Args.TopLevelFlags = RF_Public | RF_Standalone; Args.Error = GWarn;
		const bool bOk = UPackage::SavePackage(Pkg, Cloud, *File, Args);
		UE_LOG(LogPhoneTwinEditor, Log, TEXT("%s %s (%d points)"), bOk ? TEXT("Saved") : TEXT("Could not save"), *PackageName, Pts.Num());
		return bOk;
	}

	FTSTicker::FDelegateHandle Ticker;
	FDelegateHandle SyncHandle;
	TArray<IConsoleObject*> Commands;
	TSet<FString> Failed;
	double NextSync = 0, NextScan = 0;
};

IMPLEMENT_MODULE(FPhoneTwinLinkEditorModule, PhoneTwinLinkEditor)
