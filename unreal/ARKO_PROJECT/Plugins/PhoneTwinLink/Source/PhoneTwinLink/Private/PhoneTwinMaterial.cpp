// The immersive look on the GPU: one material on the static point cloud computes, every frame and for every point, what
// BuildImmersive / BuildGlow used to compute on the CPU (real colours around the audience, drifting blue dust, the trail,
// gold touch waves). Nothing is rebuilt or re-uploaded while playing, so the picture runs at the game's frame rate.
#include "PhoneTwinCloud.h"
#include "Materials/Material.h"
#include "Materials/MaterialInterface.h"
#include "MaterialDomain.h"
#include "Engine/Texture2D.h"
#include "UObject/Package.h"
#include "UObject/UObjectGlobals.h"
#if WITH_EDITOR
#include "Materials/MaterialExpressionCustom.h"
#include "Materials/MaterialExpressionVertexColor.h"
#include "Materials/MaterialExpressionWorldPosition.h"
#include "Materials/MaterialExpressionVectorParameter.h"
#include "Materials/MaterialExpressionTextureObjectParameter.h"
#include "Materials/MaterialExpressionAppendVector.h"
#include "Materials/MaterialExpressionConstant.h"
#include "MaterialShared.h"
#include "RHIGlobals.h"
#endif

DEFINE_LOG_CATEGORY_STATIC(LogPhoneTwinMat, Log, All);

namespace PhoneTwin
{
	// Same numbers as BuildImmersive / BuildGlow (PhoneTwinCloud.cpp) and web/immersive.js. Units: cm in the actor's frame.
	// P = world position of the sprite corner, C = point colour (linear), Stage 0 = emissive colour, 1 = world position offset.
	static const TCHAR* GImmersiveCode = TEXT(R"HLSL(
float3 C0 = C.rgb;
float cy = cos(Org.w), sy = sin(Org.w);
float3 d0 = P - Org.xyz;
float3 L = float3(cy * d0.x + sy * d0.y, -sy * d0.x + cy * d0.y, d0.z);
float3 q = floor(C0 * 255.0 + 0.5);
float Rnd = frac(sin(dot(q, float3(12.9898, 78.233, 37.719))) * 43758.5453);
float S1 = frac(sin(dot(q, float3(39.346, 11.135, 83.155))) * 24634.6345);
float T = Bv.w;
float Mode = Cm.x;
float Reveal = saturate(A.z);
float D = length(L.xy - A.xy) / 100.0;
float3 Col = C0;
float3 Off = float3(0, 0, 0);
if (Mode > 3.5)
{
}
else if (Mode > 2.5)
{
	float Dcm = D * 100.0;
	float FarR = max(G1.y, G1.x + 1.0);
	float t = saturate((Dcm - G1.x) / (FarR - G1.x));
	float Near = Reveal * (1.0 - t * t * (3.0 - 2.0 * t));
	float Dim = lerp(G2.x, G1.w, Reveal);
	float Tw = 1.0 - G2.z * (1.0 - Near) * (0.5 + 0.5 * sin(T * (0.8 + 1.4 * S1) + Rnd * 6.283));
	Col = lerp(C0, float3(1, 1, 1), G2.y * Near) * (lerp(Dim, G1.z, Near) * Tw);
}
else
{
	float R = max(0.05, A.w / 100.0);
	float Near = (1.0 - smoothstep(R * 0.45, R, D)) * Reveal;
	float2 uv = (L.xy - Mem.xy) / max(Mem.zw, float2(1.0, 1.0));
	float M = Trail.SampleLevel(TrailSampler, uv, 0).r;
	float MemK = Mode > 1.5 ? 0.9 : 0.7;
	float FarA0 = Mode > 1.5 ? 0.30 : 0.10;
	float Lit = max(Near, M * MemK);
	float Wave = 0;
	if (Mode > 0.5 && Mode < 1.5)
	{
		float4 Ws[4] = { W0, W1, W2, W3 };
		float Amps[4] = { WA.x, WA.y, WA.z, WA.w };
		for (int k = 0; k < 4; k++)
		{
			float Age = Ws[k].w;
			if (Age < 0.0 || Age > 8.0 || Amps[k] <= 0.0) continue;
			float Dw = length(L - Ws[k].xyz) / 100.0, Wr = Age * Cm.y / 100.0;
			float a1 = (Dw - Wr) * 4.5, a2 = (Dw - Wr * 0.6) * 7.0;
			float Ring = exp(-a1 * a1) + 0.35 * exp(-a2 * a2);
			Wave = max(Wave, Ring * exp(-Age * 0.45) * Amps[k]);
		}
		Lit = max(Lit, Wave * 0.8);
	}
	Lit = min(Lit, 1.0);
	float Far = 1.0 - Lit;
	float Tw = 0.65 + 0.35 * sin(T * (1.2 + Rnd * 3.0) + Rnd * 50.0);
	float FarA = FarA0 * Tw * (1.0 - smoothstep(R, R * 5.0, D) * 0.6);
	float Al = saturate(lerp(FarA, 1.0, Lit) * Bv.y);
	float Shown = min(1.0, Al * 2.5);
	float Px = L.x / 100.0, Py = L.z / 100.0, Pz = L.y / 100.0;
	float Td = T * 0.18 + Rnd * 6.2832;
	float Dx = sin(Td * 1.3 + Py * 2.1 + Pz), Dz = cos(Td * 1.1 + Px * 1.9 - Py);
	float Dy = sin(Td * 0.7 + Px * 1.3) * 0.5 + (Rnd - 0.25) * 0.9 + (Py - Bv.z / 100.0) * 0.15;
	float Amt = Bv.x * Far * Far * (0.3 + 0.7 * Rnd) * 100.0;
	float3 OffL = float3(Dx, Dz, Dy) * Amt;
	Off = float3(cy * OffL.x - sy * OffL.y, sy * OffL.x + cy * OffL.y, OffL.z);
	float Grey = dot(C0, float3(0.299, 0.587, 0.114));
	Col = lerp(float3(0.45, 0.62, 1.0) * (0.35 + Grey), C0 * 1.1, Lit) + float3(1.0, 0.78, 0.4) * (Wave * 0.45);
	Col *= Shown * lerp(0.6, 1.0, Lit) * (1.0 + Wave * 0.9) * lerp(0.6, 1.0, Lit);
}
if (Stage > 0.5) return Off;
return saturate(Col) * Gain.rgb;
)HLSL");

	const TCHAR* ImmersiveMaterialPath() { return TEXT("/Game/PhoneTwinScans/M_PhoneTwinImmersive.M_PhoneTwinImmersive"); }

#if WITH_EDITOR
	UMaterial* BuildImmersiveMaterial(UObject* Outer, FName Name, EObjectFlags Flags)
	{
		UMaterial* M = NewObject<UMaterial>(Outer, Name, Flags);
		M->MaterialDomain = MD_Surface;
		M->SetShadingModel(MSM_Unlit);
		M->BlendMode = BLEND_Masked;
		M->OpacityMaskClipValue = .5f;
		M->TwoSided = true;
		M->bUsedWithLidarPointCloud = true;
		UMaterialEditorOnlyData* Ed = M->GetEditorOnlyData();

		auto Add = [M](UMaterialExpression* E) { E->Material = M; M->GetExpressionCollection().AddExpression(E); return E; };
		auto* VC = Cast<UMaterialExpressionVertexColor>(Add(NewObject<UMaterialExpressionVertexColor>(M)));
		auto* WP = Cast<UMaterialExpressionWorldPosition>(Add(NewObject<UMaterialExpressionWorldPosition>(M)));
		WP->WorldPositionShaderOffset = WPT_ExcludeAllShaderOffsets;   // the point's own place, also in the pixel shader
		// a vector parameter's first pin is RGB only: append its alpha pin to get all four values
		auto Vec4 = [&](const TCHAR* ParamName, const FLinearColor& Default) -> UMaterialExpression*
		{
			auto* P = Cast<UMaterialExpressionVectorParameter>(Add(NewObject<UMaterialExpressionVectorParameter>(M)));
			P->ParameterName = ParamName; P->DefaultValue = Default;
			auto* Ap = Cast<UMaterialExpressionAppendVector>(Add(NewObject<UMaterialExpressionAppendVector>(M)));
			Ap->A.Connect(0, P); Ap->B.Connect(4, P);
			return Ap;
		};
		auto* Gain = Cast<UMaterialExpressionVectorParameter>(Add(NewObject<UMaterialExpressionVectorParameter>(M)));
		Gain->ParameterName = TEXT("PC__Gain"); Gain->DefaultValue = FLinearColor::White;   // the LiDAR component sets it (Cloud->Gain)
		auto* Tex = Cast<UMaterialExpressionTextureObjectParameter>(Add(NewObject<UMaterialExpressionTextureObjectParameter>(M)));
		Tex->ParameterName = TEXT("PT_Trail");
		Tex->Texture = LoadObject<UTexture2D>(nullptr, TEXT("/Engine/EngineResources/Black.Black"));
		Tex->SamplerType = SAMPLERTYPE_LinearColor;

		struct FIn { const TCHAR* Name; UMaterialExpression* E; int32 Out; };
		const TArray<FIn> Shared = {
			{ TEXT("C"), VC, 0 }, { TEXT("P"), WP, 0 },
			{ TEXT("Org"), Vec4(TEXT("PT_Org"), FLinearColor(0, 0, 0, 0)), 0 },
			{ TEXT("A"), Vec4(TEXT("PT_A"), FLinearColor(0, 0, 0, 160)), 0 },
			{ TEXT("Bv"), Vec4(TEXT("PT_B"), FLinearColor(.6f, 1, 0, 0)), 0 },
			{ TEXT("Cm"), Vec4(TEXT("PT_C"), FLinearColor(4, 180, 0, 0)), 0 },
			{ TEXT("W0"), Vec4(TEXT("PT_W0"), FLinearColor(0, 0, 0, -1)), 0 },
			{ TEXT("W1"), Vec4(TEXT("PT_W1"), FLinearColor(0, 0, 0, -1)), 0 },
			{ TEXT("W2"), Vec4(TEXT("PT_W2"), FLinearColor(0, 0, 0, -1)), 0 },
			{ TEXT("W3"), Vec4(TEXT("PT_W3"), FLinearColor(0, 0, 0, -1)), 0 },
			{ TEXT("WA"), Vec4(TEXT("PT_WA"), FLinearColor(0, 0, 0, 0)), 0 },
			{ TEXT("Mem"), Vec4(TEXT("PT_Mem"), FLinearColor(-300, -300, 600, 600)), 0 },
			{ TEXT("G1"), Vec4(TEXT("PT_G1"), FLinearColor(120, 450, 1, .18f)), 0 },
			{ TEXT("G2"), Vec4(TEXT("PT_G2"), FLinearColor(.35f, .35f, .2f, 0)), 0 },
			{ TEXT("Trail"), Tex, 0 }, { TEXT("Gain"), Gain, 0 },
		};
		auto MakeCustom = [&](float Stage)
		{
			auto* Cu = Cast<UMaterialExpressionCustom>(Add(NewObject<UMaterialExpressionCustom>(M)));
			Cu->Code = GImmersiveCode; Cu->OutputType = CMOT_Float3; Cu->Description = Stage > .5f ? TEXT("PhoneTwinOffset") : TEXT("PhoneTwinColour");
			Cu->Inputs.Reset();
			for (const FIn& I : Shared) { FCustomInput C; C.InputName = I.Name; C.Input.Connect(I.Out, I.E); Cu->Inputs.Add(C); }
			auto* K = Cast<UMaterialExpressionConstant>(Add(NewObject<UMaterialExpressionConstant>(M))); K->R = Stage;
			FCustomInput S; S.InputName = TEXT("Stage"); S.Input.Connect(0, K); Cu->Inputs.Add(S);
			return Cu;
		};
		Ed->EmissiveColor.Connect(0, MakeCustom(0));
		Ed->WorldPositionOffset.Connect(0, MakeCustom(1));
		Ed->OpacityMask.Connect(4, VC);   // round points: the LiDAR vertex factory puts the circle in the vertex alpha
		M->PreEditChange(nullptr);
		M->PostEditChange();
		return M;
	}
#endif

	UMaterialInterface* GetImmersiveMaterial()
	{
		static TWeakObjectPtr<UMaterialInterface> Cached;
		static bool bTried = false;
		if (Cached.IsValid()) return Cached.Get();
		if (bTried) return nullptr;
		bTried = true;
		// a saved asset (made by the editor module) works in packaged games too
		UMaterialInterface* M = LoadObject<UMaterialInterface>(nullptr, ImmersiveMaterialPath(), nullptr, LOAD_NoWarn | LOAD_Quiet);
#if WITH_EDITOR
		if (!M)
		{
			UMaterial* Built = BuildImmersiveMaterial(GetTransientPackage(), TEXT("M_PhoneTwinImmersive_Transient"), RF_Transient);
			Built->AddToRoot();
			M = Built;
		}
		// the first frames must not draw the default material: wait for this one's shaders (cached after the first time)
		if (UMaterial* Base = M ? M->GetMaterial() : nullptr)
			if (FMaterialResource* R = Base->GetMaterialResource(GMaxRHIFeatureLevel)) R->FinishCompilation();
#endif
		if (M) { UE_LOG(LogPhoneTwinMat, Log, TEXT("immersive material: %s"), *M->GetPathName()); }
		else { UE_LOG(LogPhoneTwinMat, Warning, TEXT("immersive material not available: falling back to rebuilding the cloud on the CPU")); }
		Cached = M;
		return M;
	}
}
