#include "PhoneTwinSync.h"
#include "HttpModule.h"
#include "Interfaces/IHttpRequest.h"
#include "Interfaces/IHttpResponse.h"
#include "HAL/FileManager.h"
#include "HAL/PlatformMisc.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"

DEFINE_LOG_CATEGORY_STATIC(LogPhoneTwinSync, Log, All);

FString UPhoneTwinSettings::ScanDir()
{
	return FPaths::ConvertRelativePathToFull(FPaths::ProjectContentDir() / TEXT("PhoneTwinScans"));
}

FPhoneTwinSync& FPhoneTwinSync::Get()
{
	static FPhoneTwinSync Instance;
	return Instance;
}

TArray<FPhoneTwinLocalScan> FPhoneTwinSync::LocalScans()
{
	const FString Dir = UPhoneTwinSettings::ScanDir();
	TMap<FString, FDateTime> Created;
	FString Index;
	if (FFileHelper::LoadFileToString(Index, *(Dir / TEXT("index.json"))))
	{
		TArray<PhoneTwin::FScanEntry> E; PhoneTwin::ParseIndex(Index, E);
		for (const PhoneTwin::FScanEntry& S : E) { FDateTime T; if (FDateTime::ParseIso8601(*S.Created, T)) Created.Add(S.Id, T); }
	}
	TArray<FString> Files; IFileManager::Get().FindFiles(Files, *(Dir / TEXT("*.ply")), true, false);
	TArray<FPhoneTwinLocalScan> Out;
	for (const FString& F : Files)
	{
		FPhoneTwinLocalScan S; S.Id = FPaths::GetBaseFilename(F); S.PlyPath = Dir / F;
		const FString Meta = Dir / (S.Id + TEXT(".json"));
		if (FPaths::FileExists(Meta)) S.MetaPath = Meta;
		const FDateTime* T = Created.Find(S.Id);
		S.Time = T ? *T : IFileManager::Get().GetTimeStamp(*S.PlyPath);
		Out.Add(S);
	}
	Out.Sort([](const FPhoneTwinLocalScan& A, const FPhoneTwinLocalScan& B) { return A.Time > B.Time; });
	return Out;
}

void FPhoneTwinSync::Fetch(const FString& Path, TFunction<void(bool, int32, const TArray<uint8>&)> Done, bool bRaw)
{
	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> R = FHttpModule::Get().CreateRequest();
	// The contents API is never stale and serves files up to 100 MB; raw.githubusercontent.com is the fallback
	// when the anonymous API rate limit (60/h) is used up.
	R->SetURL(bRaw ? FString::Printf(TEXT("https://raw.githubusercontent.com/%s/%s/%s"), *Repo, *Branch, *Path)
	               : FString::Printf(TEXT("https://api.github.com/repos/%s/contents/%s?ref=%s"), *Repo, *Path, *Branch));
	R->SetVerb(TEXT("GET"));
	R->SetHeader(TEXT("User-Agent"), TEXT("PhoneTwin-Unreal"));
	if (!bRaw) R->SetHeader(TEXT("Accept"), TEXT("application/vnd.github.raw+json"));
	const FString Token = FPlatformMisc::GetEnvironmentVariable(TEXT("GITHUB_TOKEN"));
	if (!Token.IsEmpty() && !bRaw) R->SetHeader(TEXT("Authorization"), TEXT("Bearer ") + Token);
	R->SetTimeout(180.f);
	R->OnProcessRequestComplete().BindLambda([this, Path, Done, bRaw](FHttpRequestPtr, FHttpResponsePtr Res, bool bOk)
	{
		const int32 Code = Res.IsValid() ? Res->GetResponseCode() : 0;
		if (!bRaw && (Code == 403 || Code == 429)) { Fetch(Path, Done, true); return; }
		static const TArray<uint8> Empty;
		Done(bOk && Code == 200, Code, Res.IsValid() ? Res->GetContent() : Empty);
	});
	R->ProcessRequest();
}

void FPhoneTwinSync::Run()
{
	if (bRunning) return;
	const UPhoneTwinSettings* S = GetDefault<UPhoneTwinSettings>();
	Repo = S->Repository.TrimStartAndEnd(); Branch = S->Branch.TrimStartAndEnd();
	if (Repo.IsEmpty() || !Repo.Contains(TEXT("/"))) { Status = TEXT("GitHub 저장소가 설정되지 않음 (프로젝트 설정 > Phone Twin)"); OnSynced.Broadcast(false, Status); return; }
	bRunning = true; Downloaded = 0; Jobs.Reset();
	Status = TEXT("GitHub 확인 중…");
	Fetch(TEXT("scans/index.json"), [this, S](bool bOk, int32 Code, const TArray<uint8>& Data)
	{
		if (!bOk)
		{
			Finish(false, Code == 404 ? FString::Printf(TEXT("%s 에 scans/index.json 이 아직 없음"), *Repo)
			                          : FString::Printf(TEXT("GitHub 연결 실패 (HTTP %d)"), Code));
			return;
		}
		FFileHelper::BufferToString(IndexJson, Data.GetData(), Data.Num());
		TArray<PhoneTwin::FScanEntry> Entries;
		if (!PhoneTwin::ParseIndex(IndexJson, Entries)) { Finish(false, TEXT("index.json 형식 오류")); return; }
		const FString Dir = UPhoneTwinSettings::ScanDir();
		IFileManager::Get().MakeDirectory(*Dir, true);
		for (int32 i = 0; i < FMath::Min(Entries.Num(), S->MaxScansToDownload); i++)
		{
			const PhoneTwin::FScanEntry& E = Entries[i];
			const FString Ply = Dir / (E.Id + TEXT(".ply")), Meta = Dir / (E.Id + TEXT(".json"));
			if (IFileManager::Get().FileSize(*Meta) <= 0) Jobs.Add({E.Meta, Meta});
			if (IFileManager::Get().FileSize(*Ply) <= 0) Jobs.Add({E.Ply, Ply});
		}
		Next();
	});
}

void FPhoneTwinSync::Next()
{
	if (Jobs.Num() == 0)
	{
		FFileHelper::SaveStringToFile(IndexJson, *(UPhoneTwinSettings::ScanDir() / TEXT("index.json")), FFileHelper::EEncodingOptions::ForceUTF8WithoutBOM);
		Finish(true, Downloaded > 0 ? FString::Printf(TEXT("GitHub에서 파일 %d개를 받았습니다"), Downloaded) : TEXT("GitHub 최신 상태"));
		return;
	}
	const FJob J = Jobs[0]; Jobs.RemoveAt(0);
	Status = FString::Printf(TEXT("내려받는 중: %s (남은 %d)"), *FPaths::GetCleanFilename(J.LocalPath), Jobs.Num());
	Fetch(J.RemotePath, [this, J](bool bOk, int32 Code, const TArray<uint8>& Data)
	{
		if (bOk && Data.Num() > 0)
		{
			const FString Part = J.LocalPath + TEXT(".part");
			if (FFileHelper::SaveArrayToFile(Data, *Part) && IFileManager::Get().Move(*J.LocalPath, *Part, true)) Downloaded++;
			else UE_LOG(LogPhoneTwinSync, Warning, TEXT("cannot write %s"), *J.LocalPath);
		}
		else UE_LOG(LogPhoneTwinSync, Warning, TEXT("download %s failed (HTTP %d)"), *J.RemotePath, Code);
		Next();
	});
}

void FPhoneTwinSync::Finish(bool bOk, const FString& Message)
{
	const bool bNew = Downloaded > 0;
	bRunning = false; Status = Message;
	UE_LOG(LogPhoneTwinSync, Log, TEXT("%s"), *Message);
	OnSynced.Broadcast(bNew, Status);
}
