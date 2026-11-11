$javaPath = "C:\Program Files\Android\Android Studio\jbr"
$env:JAVA_HOME = $javaPath
$env:PATH = "$javaPath\bin;" + $env:PATH

# Automatically sync latest web files to Android assets before compilation
Write-Host "Syncing web assets to Android build directory..." -ForegroundColor Cyan
Copy-Item "$PSScriptRoot\index.html", "$PSScriptRoot\owner.html", "$PSScriptRoot\download.html", "$PSScriptRoot\manifest.json", "$PSScriptRoot\manifest-owner.json" -Destination "$PSScriptRoot\android\app\src\main\assets\" -Force
Copy-Item "$PSScriptRoot\css\*" -Destination "$PSScriptRoot\android\app\src\main\assets\css\" -Recurse -Force
Copy-Item "$PSScriptRoot\js\*" -Destination "$PSScriptRoot\android\app\src\main\assets\js\" -Recurse -Force
if (-not (Test-Path "$PSScriptRoot\android\app\src\main\assets\data")) { New-Item -ItemType Directory -Path "$PSScriptRoot\android\app\src\main\assets\data" -Force | Out-Null }
Copy-Item "$PSScriptRoot\data\*" -Destination "$PSScriptRoot\android\app\src\main\assets\data\" -Force

Set-Location -Path "$PSScriptRoot\android"
& ".\gradlew.bat" assembleCustomerRelease assembleOwnerRelease --no-daemon
if ($LASTEXITCODE -eq 0) {
    Write-Host "Build Succeeded!" -ForegroundColor Green
    Copy-Item "app\build\outputs\apk\customer\release\app-customer-release.apk" -Destination "$PSScriptRoot\apks\LoyaltyPass-Customer.apk" -Force
    Copy-Item "app\build\outputs\apk\customer\release\app-customer-release.apk" -Destination "$PSScriptRoot\download\apks\LoyaltyPass-Customer.apk" -Force
    Copy-Item "app\build\outputs\apk\owner\release\app-owner-release.apk" -Destination "$PSScriptRoot\apks\StoreTerminal-Owner.apk" -Force
    Copy-Item "app\build\outputs\apk\owner\release\app-owner-release.apk" -Destination "$PSScriptRoot\download\apks\StoreTerminal-Owner.apk" -Force
    Write-Host "APKs copied successfully!" -ForegroundColor Green
} else {
    Write-Host "Build Failed with code $LASTEXITCODE" -ForegroundColor Red
}
