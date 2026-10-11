using UnrealBuildTool;

public class PhoneTwinLink : ModuleRules
{
	public PhoneTwinLink(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
		PublicDependencyModuleNames.AddRange(new string[] { "Core", "CoreUObject", "Engine", "DeveloperSettings", "LidarPointCloudRuntime" });
		PrivateDependencyModuleNames.AddRange(new string[] { "Sockets", "Networking", "HTTP", "Json", "Slate", "SlateCore", "InputCore", "AudioExtensions" });
	}
}
