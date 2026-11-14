// Phone Twin v4 — the start screen of the packaged game: only what changes from site to site (input, scan, relay,
// OSC, ports, vibration device, window). Remembered in <Saved>/PhoneTwinSetup.json for the next start.
#pragma once
#include "CoreMinimal.h"

class SWidget;

struct PHONETWINLINK_API FPhoneTwinSetupValues
{
	int32 Source = 0;                                        // 0 휴대폰, 1 UWB 태그 (Pi OSC) / ESP32
	FString Scan;                                            // empty = what the collision editor saved last, else the newest
	bool bAutoSync = true;                                   // download new scans from GitHub while running
	bool bRelay = true;                                      // internet relay (phone app, web viewer, visitor trails)
	FString RelayRoom = TEXT("arko");
	FString RelayKey;                                        // empty = the key built into the package
	bool bOsc = true;                                        // to TouchDesigner
	FString OscHost = TEXT("127.0.0.1");
	int32 OscPort = 7000;
	int32 UwbPort = 8000;                                    // OSC from the UWB gateway (Raspberry Pi); 0 = off
	FString EspAddress;                                      // vibration device (ESP32 / Pi); empty = learn it from its packets
	bool bFullscreen = true;
	bool bAskAtStart = true;                                 // show this screen on every start

	static FString File();
	bool Load();
	bool Save() const;
	/** Empty when fine, else what to fix (Korean, shown on the screen). */
	FString Problem() const;
};

/** The start screen. OnStart gets the values the visitor confirmed; OnClose (may be empty) closes it without changes; OnQuit = ESC. */
PHONETWINLINK_API TSharedRef<SWidget> MakePhoneTwinSetupWidget(const FPhoneTwinSetupValues& Init, const TArray<FString>& ScanIds, bool bHasBuiltInKey,
	TFunction<void(const FPhoneTwinSetupValues&)> OnStart, TFunction<void()> OnClose, TFunction<void()> OnQuit);
