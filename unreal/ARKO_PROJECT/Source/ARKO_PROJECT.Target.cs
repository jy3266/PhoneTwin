using UnrealBuildTool;

public class ARKO_PROJECTTarget : TargetRules
{
	public ARKO_PROJECTTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Game;
		DefaultBuildSettings = BuildSettingsVersion.V5;
		IncludeOrderVersion = EngineIncludeOrderVersion.Unreal5_5;
		ExtraModuleNames.Add("ARKO_PROJECT");
	}
}
