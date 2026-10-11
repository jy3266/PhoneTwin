#include "PhoneTwinCore.h"
#include "Misc/FileHelper.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"

namespace PhoneTwin
{
// ------------------------------------------------------------------------------------------------ PLY
namespace
{
	enum class EType : uint8 { I8, U8, I16, U16, I32, U32, F32, F64, Bad };
	EType ParseType(const FString& T)
	{
		if (T == TEXT("char") || T == TEXT("int8")) return EType::I8;
		if (T == TEXT("uchar") || T == TEXT("uint8")) return EType::U8;
		if (T == TEXT("short") || T == TEXT("int16")) return EType::I16;
		if (T == TEXT("ushort") || T == TEXT("uint16")) return EType::U16;
		if (T == TEXT("int") || T == TEXT("int32")) return EType::I32;
		if (T == TEXT("uint") || T == TEXT("uint32")) return EType::U32;
		if (T == TEXT("float") || T == TEXT("float32")) return EType::F32;
		if (T == TEXT("double") || T == TEXT("float64")) return EType::F64;
		return EType::Bad;
	}
	int32 Size(EType T)
	{
		switch (T) { case EType::I8: case EType::U8: return 1; case EType::I16: case EType::U16: return 2;
			case EType::I32: case EType::U32: case EType::F32: return 4; case EType::F64: return 8; default: return 0; }
	}
	double Read(const uint8* P, EType T, bool bSwap)
	{
		uint8 B[8]; const int32 N = Size(T);
		for (int32 i = 0; i < N; i++) B[i] = bSwap ? P[N - 1 - i] : P[i];
		switch (T)
		{
		case EType::I8: return (double)*(int8*)B;   case EType::U8: return (double)B[0];
		case EType::I16: { int16 v; FMemory::Memcpy(&v, B, 2); return v; }
		case EType::U16: { uint16 v; FMemory::Memcpy(&v, B, 2); return v; }
		case EType::I32: { int32 v; FMemory::Memcpy(&v, B, 4); return v; }
		case EType::U32: { uint32 v; FMemory::Memcpy(&v, B, 4); return v; }
		case EType::F32: { float v; FMemory::Memcpy(&v, B, 4); return v; }
		case EType::F64: { double v; FMemory::Memcpy(&v, B, 8); return v; }
		default: return 0;
		}
	}
	uint8 ToByte(double V, EType T) { return (uint8)FMath::Clamp(T == EType::F32 || T == EType::F64 ? V * 255.0 : T == EType::U16 ? V / 257.0 : V, 0.0, 255.0); }
}

bool LoadPly(const FString& Path, TArray<FVector3f>& OutS, TArray<FColor>& OutColor, FString& OutError)
{
	OutS.Reset(); OutColor.Reset();
	TArray<uint8> Data;
	if (!FFileHelper::LoadFileToArray(Data, *Path)) { OutError = TEXT("cannot read file"); return false; }

	// header
	int64 HeaderEnd = -1;
	for (int64 i = 0; i + 10 < Data.Num() && i < 65536; i++)
		if (FMemory::Memcmp(Data.GetData() + i, "end_header", 10) == 0)
		{
			int64 j = i + 10; while (j < Data.Num() && Data[j] != '\n') j++;
			HeaderEnd = j + 1; break;
		}
	if (HeaderEnd < 0 || Data.Num() < 3 || FMemory::Memcmp(Data.GetData(), "ply", 3) != 0) { OutError = TEXT("not a PLY file"); return false; }
	FString Header; FFileHelper::BufferToString(Header, Data.GetData(), (int32)HeaderEnd);
	TArray<FString> Lines; Header.ParseIntoArrayLines(Lines);

	enum class EFormat { Ascii, LE, BE } Format = EFormat::Ascii;
	struct FProp { FString Name; EType Type; };
	struct FElem { FString Name; int64 Count = 0; TArray<FProp> Props; bool bHasList = false; };
	TArray<FElem> Elems;
	for (const FString& L : Lines)
	{
		TArray<FString> W; L.ParseIntoArrayWS(W);
		if (W.Num() == 0) continue;
		if (W[0] == TEXT("format") && W.Num() > 1)
			Format = W[1] == TEXT("ascii") ? EFormat::Ascii : W[1] == TEXT("binary_big_endian") ? EFormat::BE : EFormat::LE;
		else if (W[0] == TEXT("element") && W.Num() > 2) { FElem E; E.Name = W[1]; E.Count = FCString::Atoi64(*W[2]); Elems.Add(E); }
		else if (W[0] == TEXT("property") && Elems.Num() > 0)
		{
			if (W.Num() > 1 && W[1] == TEXT("list")) { Elems.Last().bHasList = true; continue; }
			if (W.Num() > 2) Elems.Last().Props.Add({ W[2], ParseType(W[1]) });
		}
	}
	const int32 VI = Elems.IndexOfByPredicate([](const FElem& E) { return E.Name == TEXT("vertex"); });
	if (VI == INDEX_NONE) { OutError = TEXT("no vertex element"); return false; }
	for (int32 e = 0; e < VI; e++) if (Elems[e].Count > 0) { OutError = TEXT("vertex must be the first element"); return false; }
	const FElem& V = Elems[VI];
	if (V.bHasList) { OutError = TEXT("list properties in vertex are not supported"); return false; }

	auto Find = [&V](std::initializer_list<const TCHAR*> Names) {
		for (const TCHAR* N : Names) for (int32 i = 0; i < V.Props.Num(); i++) if (V.Props[i].Name == N) return i;
		return (int32)INDEX_NONE;
	};
	const int32 IX = Find({TEXT("x")}), IY = Find({TEXT("y")}), IZ = Find({TEXT("z")});
	const int32 IR = Find({TEXT("red"), TEXT("r"), TEXT("diffuse_red")}), IG = Find({TEXT("green"), TEXT("g"), TEXT("diffuse_green")}), IB = Find({TEXT("blue"), TEXT("b"), TEXT("diffuse_blue")});
	if (IX < 0 || IY < 0 || IZ < 0) { OutError = TEXT("vertex has no x/y/z"); return false; }
	for (const FProp& P : V.Props) if (P.Type == EType::Bad) { OutError = TEXT("unknown property type"); return false; }
	const bool bColour = IR >= 0 && IG >= 0 && IB >= 0;

	OutS.Reserve(V.Count); if (bColour) OutColor.Reserve(V.Count);
	if (Format == EFormat::Ascii)
	{
		FString Body; FFileHelper::BufferToString(Body, Data.GetData() + HeaderEnd, (int32)(Data.Num() - HeaderEnd));
		TArray<FString> Rows; Body.ParseIntoArrayLines(Rows);
		TArray<FString> W;
		for (int64 r = 0; r < FMath::Min<int64>(V.Count, Rows.Num()); r++)
		{
			Rows[r].ParseIntoArrayWS(W); if (W.Num() < V.Props.Num()) continue;
			auto Val = [&W](int32 i) { return FCString::Atod(*W[i]); };
			OutS.Add(FVector3f(Val(IX), Val(IY), Val(IZ)));
			if (bColour) OutColor.Add(FColor(ToByte(Val(IR), V.Props[IR].Type), ToByte(Val(IG), V.Props[IG].Type), ToByte(Val(IB), V.Props[IB].Type)));
		}
	}
	else
	{
		TArray<int32> Offset; int32 Stride = 0;
		for (const FProp& P : V.Props) { Offset.Add(Stride); Stride += Size(P.Type); }
		const bool bSwap = (Format == EFormat::BE) == PLATFORM_LITTLE_ENDIAN;
		const int64 Avail = (Data.Num() - HeaderEnd) / FMath::Max(1, Stride);
		if (Avail < V.Count) { OutError = FString::Printf(TEXT("file truncated (%lld of %lld points)"), Avail, V.Count); }
		const uint8* Base = Data.GetData() + HeaderEnd;
		for (int64 r = 0; r < FMath::Min(V.Count, Avail); r++)
		{
			const uint8* Row = Base + r * Stride;
			auto Val = [&](int32 i) { return Read(Row + Offset[i], V.Props[i].Type, bSwap); };
			OutS.Add(FVector3f(Val(IX), Val(IY), Val(IZ)));
			if (bColour) OutColor.Add(FColor(ToByte(Val(IR), V.Props[IR].Type), ToByte(Val(IG), V.Props[IG].Type), ToByte(Val(IB), V.Props[IB].Type)));
		}
	}
	// drop non-finite points
	for (int32 i = OutS.Num() - 1; i >= 0; i--)
		if (!FMath::IsFinite(OutS[i].X) || !FMath::IsFinite(OutS[i].Y) || !FMath::IsFinite(OutS[i].Z)) { OutS.RemoveAtSwap(i); if (bColour) OutColor.RemoveAtSwap(i); }
	if (OutS.Num() == 0) { OutError = TEXT("no points"); return false; }
	return true;
}

bool SavePly(const FString& Path, const TArray<FVector3f>& S, const TArray<FColor>& Color)
{
	FString H = FString::Printf(TEXT("ply\nformat binary_little_endian 1.0\ncomment PhoneTwin, Y up, metres\nelement vertex %d\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n"), S.Num());
	TArray<uint8> Out; FTCHARToUTF8 U(*H); Out.Append((const uint8*)U.Get(), U.Length());
	Out.Reserve(Out.Num() + S.Num() * 15);
	for (int32 i = 0; i < S.Num(); i++)
	{
		const float P[3] = { S[i].X, S[i].Y, S[i].Z }; Out.Append((const uint8*)P, 12);   // Windows is little-endian
		const FColor C = Color.IsValidIndex(i) ? Color[i] : FColor(170, 170, 170);
		Out.Add(C.R); Out.Add(C.G); Out.Add(C.B);
	}
	return FFileHelper::SaveArrayToFile(Out, *Path);
}

// ------------------------------------------------------------------------------------------------ JSON
static bool Vec3(const TSharedPtr<FJsonObject>& O, const TCHAR* Field, FVector3f& Out)
{
	const TArray<TSharedPtr<FJsonValue>>* A;
	if (!O->TryGetArrayField(Field, A) || A->Num() < 3) return false;
	Out = FVector3f((*A)[0]->AsNumber(), (*A)[1]->AsNumber(), (*A)[2]->AsNumber());
	return true;
}

bool ParseMeta(const FString& Json, FScanMeta& Out)
{
	TSharedPtr<FJsonObject> O;
	if (!FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Json), O) || !O.IsValid()) return false;
	Out = FScanMeta();
	O->TryGetStringField(TEXT("id"), Out.Id); O->TryGetStringField(TEXT("created"), Out.Created); O->TryGetStringField(TEXT("device"), Out.Device);
	Out.bHasAB = Vec3(O, TEXT("a"), Out.A) && Vec3(O, TEXT("b"), Out.B);
	const TArray<TSharedPtr<FJsonValue>>* Arr;
	if (O->TryGetArrayField(TEXT("objects"), Arr))
		for (const TSharedPtr<FJsonValue>& V : *Arr)
		{
			const TSharedPtr<FJsonObject>* E; if (!V->TryGetObject(E)) continue;
			FScanObject S; if (!Vec3(*E, TEXT("c"), S.C)) continue;
			double R = .25, Id = Out.Objects.Num() + 1; (*E)->TryGetNumberField(TEXT("r"), R); (*E)->TryGetNumberField(TEXT("id"), Id);
			S.R = R; S.Id = FMath::Clamp((int32)Id, 1, 99); (*E)->TryGetStringField(TEXT("name"), S.Name); S.Label = S.Name;
			Out.Objects.Add(S);
		}
	int32 AiIndex = 0;
	if (O->TryGetArrayField(TEXT("ai"), Arr))
		for (const TSharedPtr<FJsonValue>& V : *Arr)
		{
			const TSharedPtr<FJsonObject>* E; if (!V->TryGetObject(E)) continue;
			FScanObject S; if (!Vec3(*E, TEXT("c"), S.C)) continue;
			double R = .4; (*E)->TryGetNumberField(TEXT("r"), R); S.R = R;
			(*E)->TryGetStringField(TEXT("label"), S.Label);
			if (!(*E)->TryGetStringField(TEXT("name"), S.Name)) S.Name = S.Label;
			S.bAi = true; S.Id = 100 + AiIndex++;
			Out.Objects.Add(S);
		}
	return true;
}

bool ParseIndex(const FString& Json, TArray<FScanEntry>& Out)
{
	Out.Reset();
	TSharedPtr<FJsonObject> O;
	if (!FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Json), O) || !O.IsValid()) return false;
	const TArray<TSharedPtr<FJsonValue>>* Arr;
	if (!O->TryGetArrayField(TEXT("scans"), Arr)) return true;
	for (const TSharedPtr<FJsonValue>& V : *Arr)
	{
		const TSharedPtr<FJsonObject>* E; if (!V->TryGetObject(E)) continue;
		FScanEntry S; if (!(*E)->TryGetStringField(TEXT("id"), S.Id) || S.Id.IsEmpty()) continue;
		if (!(*E)->TryGetStringField(TEXT("ply"), S.Ply)) S.Ply = TEXT("scans/") + S.Id + TEXT(".ply");
		if (!(*E)->TryGetStringField(TEXT("meta"), S.Meta)) S.Meta = TEXT("scans/") + S.Id + TEXT(".json");
		(*E)->TryGetStringField(TEXT("created"), S.Created); (*E)->TryGetStringField(TEXT("device"), S.Device);
		double N = 0; (*E)->TryGetNumberField(TEXT("points"), N); S.Points = (int64)N;
		// ids become file names: keep them safe
		if (S.Id.Contains(TEXT("/")) || S.Id.Contains(TEXT("\\")) || S.Id.Contains(TEXT(".."))) continue;
		Out.Add(S);
	}
	return true;
}

// ------------------------------------------------------------------------------------------------ frames
FScanFrame FScanFrame::FromMeta(const FScanMeta& Meta)
{
	FScanFrame F;
	if (!Meta.bHasAB) return F;
	const FVector A = Raw(Meta.A), B = Raw(Meta.B);
	const double Len = FVector2D(B.X - A.X, B.Y - A.Y).Size();
	if (Len < 5) return F;   // A and B closer than 5 cm: ignore
	F.bAligned = true; F.Origin = A;
	F.Cos = (B.X - A.X) / Len; F.Sin = (B.Y - A.Y) / Len;
	return F;
}

FVector FScanFrame::Point(const FVector3f& S) const
{
	const FVector R = Raw(S);
	if (!bAligned) return R;
	const FVector D = R - Origin;
	return FVector(Cos * D.X + Sin * D.Y, -Sin * D.X + Cos * D.Y, D.Z);
}

FVector FScanFrame::Dir(const FVector3f& S) const
{
	const FVector R(S.X, S.Z, S.Y);
	if (!bAligned) return R;
	return FVector(Cos * R.X + Sin * R.Y, -Sin * R.X + Cos * R.Y, R.Z);
}

// ------------------------------------------------------------------------------------------------ grid
void FPointGrid::Build(const TArray<FVector>& Points, double InCell)
{
	Cell = FMath::Max(.1, InCell); Buckets.Reset(); Count = 0;
	TSet<FIntVector> Seen; Seen.Reserve(Points.Num());
	for (const FVector& P : Points)
	{
		bool bDup = false;
		Seen.Add(FIntVector(FMath::FloorToInt(P.X / Cell), FMath::FloorToInt(P.Y / Cell), FMath::FloorToInt(P.Z / Cell)), &bDup);
		if (bDup) continue;
		Buckets.FindOrAdd(BucketKey(P)).Add(P); Count++;
	}
}

double FPointGrid::Nearest(const FVector& Q, double MaxDist, double MinZ, FVector& OutPoint) const
{
	if (Count == 0 || MaxDist <= 0) return TNumericLimits<double>::Max();
	const double S = Cell * Bucket;
	const FIntVector K = BucketKey(Q); const int32 R = FMath::CeilToInt(MaxDist / S);
	double Best = MaxDist * MaxDist; bool bFound = false;
	for (int32 x = -R; x <= R; x++) for (int32 y = -R; y <= R; y++) for (int32 z = -R; z <= R; z++)
	{
		const FIntVector B(K.X + x, K.Y + y, K.Z + z);
		// skip buckets whose box is already farther than the best hit
		const FBox Box(FVector(B.X, B.Y, B.Z) * S, FVector(B.X + 1, B.Y + 1, B.Z + 1) * S);
		if (Box.ComputeSquaredDistanceToPoint(Q) > Best || Box.Max.Z < MinZ) continue;
		const TArray<FVector>* Pts = Buckets.Find(B);
		if (!Pts) continue;
		for (const FVector& P : *Pts)
		{
			if (P.Z < MinZ) continue;
			const double D = FVector::DistSquared(P, Q);
			if (D < Best) { Best = D; OutPoint = P; bFound = true; }
		}
	}
	return bFound ? FMath::Sqrt(Best) : TNumericLimits<double>::Max();
}

double EstimateFloorZ(const TArray<FVector>& Points)
{
	if (Points.Num() == 0) return 0;
	double Lo = TNumericLimits<double>::Max(), Hi = -Lo;
	for (const FVector& P : Points) { Lo = FMath::Min(Lo, P.Z); Hi = FMath::Max(Hi, P.Z); }
	const double Top = Lo + FMath::Max(10.0, (Hi - Lo) * .35);
	TArray<int32> Bins; Bins.SetNumZeroed(FMath::Max(1, (int32)((Top - Lo) / 2.0) + 1));
	for (const FVector& P : Points) if (P.Z <= Top) Bins[FMath::Min(Bins.Num() - 1, (int32)((P.Z - Lo) / 2.0))]++;
	int32 Best = 0; for (int32 i = 1; i < Bins.Num(); i++) if (Bins[i] > Bins[Best]) Best = i;
	return Lo + (Best + .5) * 2.0;
}

// ------------------------------------------------------------------------------------------------ packets
static bool Split(const FString& Line, const TCHAR* Tag, int32 MinFields, TArray<FString>& W)
{
	FString L = Line; L.TrimStartAndEndInline();
	L.ParseIntoArray(W, TEXT(","), false);
	return W.Num() >= MinFields && W[0] == Tag;
}

bool ParsePTP(const FString& Line, FPhonePose& Out)
{
	TArray<FString> W;
	if (!Split(Line, TEXT("PTP1"), 12, W)) return false;
	auto F = [&W](int32 i) { return (float)FCString::Atod(*W[i]); };
	Out.Seq = (uint32)FCString::Atoi64(*W[1]); Out.bValid = FCString::Atoi(*W[2]) != 0;
	Out.P = FVector3f(F(3), F(4), F(5)); Out.F = FVector3f(F(6), F(7), F(8)); Out.U = FVector3f(F(9), F(10), F(11));
	Out.ScanId = W.Num() > 12 ? W[12] : FString();
	Out.bWalk = W.Num() > 13 ? FCString::Atoi(*W[13]) != 0 : Out.bValid;
	if (Out.F.IsNearlyZero()) Out.F = FVector3f(0, 0, -1);
	if (Out.U.IsNearlyZero()) Out.U = FVector3f(0, 1, 0);
	Out.F.Normalize(); Out.U.Normalize();
	return Out.P.ContainsNaN() == false;
}

bool ParsePTE(const FString& Line, FEspPose& Out)
{
	TArray<FString> W;
	if (!Split(Line, TEXT("PTE1"), 9, W)) return false;
	Out.Seq = (uint32)FCString::Atoi64(*W[1]); Out.bValid = FCString::Atoi(*W[2]) != 0;
	Out.X = FCString::Atod(*W[3]); Out.Y = FCString::Atod(*W[4]); Out.Z = FCString::Atod(*W[5]);
	Out.Yaw = FCString::Atod(*W[6]); Out.Pitch = FCString::Atod(*W[7]); Out.Roll = FCString::Atod(*W[8]);
	return FMath::IsFinite(Out.X) && FMath::IsFinite(Out.Y) && FMath::IsFinite(Out.Z);
}

FString MakePTH(uint32 Seq, bool bValid, float Intensity01, bool bContact, int32 ObjectId, double DistanceCm)
{
	const int32 Mm = !bValid || DistanceCm >= 1e7 ? -1 : FMath::RoundToInt(FMath::Clamp(DistanceCm, 0.0, 6500.0) * 10.0);
	return FString::Printf(TEXT("PTH1,%u,%d,%d,%d,%d,%d\n"), Seq, bValid ? 1 : 0, FMath::RoundToInt(FMath::Clamp(Intensity01, 0.f, 1.f) * 255.f), bContact ? 1 : 0, ObjectId, Mm);
}
}
