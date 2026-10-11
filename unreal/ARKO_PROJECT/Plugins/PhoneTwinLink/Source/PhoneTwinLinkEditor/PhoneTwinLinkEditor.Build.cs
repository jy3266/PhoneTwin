using UnrealBuildTool;

public class PhoneTwinLinkEditor : ModuleRules
{
	public PhoneTwinLinkEditor(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
		PrivateDependencyModuleNames.AddRange(new string[] { "Core", "CoreUObject", "Engine", "UnrealEd", "AssetRegistry", "LidarPointCloudRuntime", "PhoneTwinLink" });
	}
}
