using UnrealBuildTool;

public class ARKO_PROJECTEditorTarget : TargetRules
{
	public ARKO_PROJECTEditorTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Editor;
		DefaultBuildSettings = BuildSettingsVersion.V5;
		IncludeOrderVersion = EngineIncludeOrderVersion.Unreal5_5;
		ExtraModuleNames.Add("ARKO_PROJECT");
	}
}
