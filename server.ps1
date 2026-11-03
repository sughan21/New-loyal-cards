# Ultra-lightweight HTTP & REST Server for Loyalty Card App
param(
    [int]$Port = 8085
)

$root = $PSScriptRoot
$dataDir = Join-Path $root "data"
$dataFile = Join-Path $root "data\customers.json"
$requestsFile = Join-Path $root "data\stamp_requests.json"
$deletedFile = Join-Path $root "data\deleted_phones.json"

if (-not (Test-Path $dataDir)) {
    New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
}
if (-not (Test-Path $dataFile)) {
    Set-Content -Path $dataFile -Value "[]" -Encoding UTF8
}
if (-not (Test-Path $requestsFile)) {
    Set-Content -Path $requestsFile -Value "[]" -Encoding UTF8
}
if (-not (Test-Path $deletedFile)) {
    Set-Content -Path $deletedFile -Value "[]" -Encoding UTF8
}

$mimeTypes = @{
    ".html" = "text/html; charset=utf-8"
    ".css"  = "text/css; charset=utf-8"
    ".js"   = "application/javascript; charset=utf-8"
    ".json" = "application/json; charset=utf-8"
    ".svg"  = "image/svg+xml"
    ".png"  = "image/png"
    ".jpg"  = "image/jpeg"
    ".jpeg" = "image/jpeg"
    ".ico"  = "image/x-icon"
    ".apk"  = "application/vnd.android.package-archive"
    ".webmanifest" = "application/manifest+json"
}

$listener = New-Object System.Net.HttpListener
$boundPorts = @($Port)
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Prefixes.Add("http://127.0.0.1:$Port/")

# Also bind secondary port (8080 if Port is 8085, or 8085 if Port is 8080) for full compatibility
$secondaryPort = if ($Port -eq 8085) { 8080 } elseif ($Port -eq 8080) { 8085 } else { $null }
if ($null -ne $secondaryPort) {
    try {
        $listener.Prefixes.Add("http://localhost:$secondaryPort/")
        $listener.Prefixes.Add("http://127.0.0.1:$secondaryPort/")
        $boundPorts += $secondaryPort
    } catch {}
}

try {
    $listener.Start()
} catch {
    # If dual-port binding fails, try only primary port
    $listener = New-Object System.Net.HttpListener
    $listener.Prefixes.Add("http://localhost:$Port/")
    $listener.Prefixes.Add("http://127.0.0.1:$Port/")
    try {
        $listener.Start()
        $boundPorts = @($Port)
    } catch {
        # Fallback to alternate ports
        foreach ($fallback in @(8080, 8081, 8082, 8085)) {
            try {
                $listener = New-Object System.Net.HttpListener
                $listener.Prefixes.Add("http://localhost:$fallback/")
                $listener.Prefixes.Add("http://127.0.0.1:$fallback/")
                $listener.Start()
                $Port = $fallback
                $boundPorts = @($fallback)
                break
            } catch {}
        }
    }
}

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  LOYALTY CARD APP & REAL-TIME APPROVAL SERVER" -ForegroundColor Green
$urlList = ($boundPorts | ForEach-Object { "http://localhost:$_/" }) -join " and "
Write-Host "  Listening on:   $urlList" -ForegroundColor Yellow
Write-Host "  Download Hub:   http://localhost:$Port/download.html" -ForegroundColor Cyan
Write-Host "  Customer Pass:  http://localhost:$Port/customer/" -ForegroundColor Green
Write-Host "  Store Owner:    http://localhost:$Port/owner/" -ForegroundColor Green
Write-Host "  Customers API:  http://localhost:$Port/api/customers" -ForegroundColor Gray
Write-Host "  Approvals API:  http://localhost:$Port/api/stamp-requests" -ForegroundColor Gray
Write-Host "  Version API:    http://localhost:$Port/api/version" -ForegroundColor Gray
Write-Host "==========================================================" -ForegroundColor Cyan

function Send-JsonResponse($res, $statusCode, $obj) {
    $jsonStr = "{}"
    if ($null -ne $obj) {
        if ($obj -is [System.Collections.IDictionary] -or $obj -is [PSCustomObject]) {
            $jsonStr = $obj | ConvertTo-Json -Depth 10 -Compress
        } elseif ($obj -is [System.Collections.ICollection] -or $obj -is [System.Array]) {
            if ($obj.Count -eq 0) {
                $jsonStr = "[]"
            } elseif ($obj.Count -eq 1) {
                $inner = @($obj)[0] | ConvertTo-Json -Depth 10 -Compress
                $jsonStr = "[$inner]"
            } else {
                $jsonStr = $obj | ConvertTo-Json -Depth 10 -Compress
            }
        } else {
            $jsonStr = $obj | ConvertTo-Json -Depth 10 -Compress
        }
    }
    if ([string]::IsNullOrEmpty($jsonStr)) {
        $jsonStr = "{}"
    }
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($jsonStr)
    $res.StatusCode = $statusCode
    $res.ContentType = "application/json; charset=utf-8"
    $res.AddHeader("Access-Control-Allow-Origin", "*")
    $res.AddHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE")
    $res.AddHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")
    $res.AddHeader("Cache-Control", "no-cache, no-store, must-revalidate")
    $res.ContentLength64 = $bytes.Length
    $res.OutputStream.Write($bytes, 0, $bytes.Length)
    $res.OutputStream.Close()
}

function Read-RequestBody($req) {
    $reader = New-Object System.IO.StreamReader($req.InputStream, [System.Text.Encoding]::UTF8)
    return $reader.ReadToEnd()
}

function Load-JsonFile($path) {
    if (Test-Path $path) {
        $raw = [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)
        if ($raw -and $raw.Trim().Length -gt 1) {
            try {
                $parsed = $raw | ConvertFrom-Json
                if ($parsed -is [System.Array]) { 
                    $list = New-Object System.Collections.ArrayList
                    foreach ($item in $parsed) { [void]$list.Add($item) }
                    return ,$list
                }
                $list = New-Object System.Collections.ArrayList
                [void]$list.Add($parsed)
                return ,$list
            } catch {
                return ,(New-Object System.Collections.ArrayList)
            }
        }
    }
    return ,(New-Object System.Collections.ArrayList)
}

function Save-JsonFile($path, $list) {
    $json = $list | ConvertTo-Json -Depth 10
    [System.IO.File]::WriteAllText($path, $json, [System.Text.Encoding]::UTF8)
}

while ($listener.IsListening) {
    try {
        $context = $listener.GetContext()
        $req = $context.Request
        $res = $context.Response

        $path = $req.Url.LocalPath.ToLower().TrimEnd('/')

        # Handle CORS OPTIONS Preflight
        if ($req.HttpMethod -eq "OPTIONS") {
            $res.StatusCode = 204
            $res.AddHeader("Access-Control-Allow-Origin", "*")
            $res.AddHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE")
            $res.AddHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")
            $res.OutputStream.Close()
            continue
        }

        # --- REST API: /api/customers ---
        if ($path -eq "/api/customers") {
            if ($req.HttpMethod -eq "GET") {
                $rawUsers = Load-JsonFile $dataFile
                $delPhones = Load-JsonFile $deletedFile
                $filtered = New-Object System.Collections.ArrayList
                foreach ($u in $rawUsers) {
                    if ($u.phone -and -not ($delPhones -contains $u.phone)) {
                        [void]$filtered.Add($u)
                    }
                }
                Send-JsonResponse $res 200 $filtered
                continue
            }
            elseif ($req.HttpMethod -eq "POST") {
                $body = Read-RequestBody $req
                $currentUsers = Load-JsonFile $dataFile
                $delPhones = Load-JsonFile $deletedFile

                try {
                    $incoming = $body | ConvertFrom-Json
                    $incomingList = @()
                    if ($incoming -is [System.Array]) { $incomingList = $incoming }
                    else { $incomingList = @($incoming) }

                    foreach ($inc in $incomingList) {
                        if (-not $inc.phone) { continue }
                        # Ignore if customer was permanently deleted
                        if ($delPhones -contains $inc.phone) { continue }

                        $foundIdx = -1
                        for ($i = 0; $i -lt $currentUsers.Count; $i++) {
                            if ($currentUsers[$i].phone -eq $inc.phone) {
                                $foundIdx = $i
                                break
                            }
                        }

                        if ($foundIdx -ge 0) {
                            $existing = $currentUsers[$foundIdx]
                            if ($inc.stamps -ne $null -and [int]$inc.stamps -gt [int]$existing.stamps) {
                                $existing.stamps = [int]$inc.stamps
                            }
                            if ($inc.giftsEarned -ne $null -and [int]$inc.giftsEarned -gt [int]$existing.giftsEarned) {
                                $existing.giftsEarned = [int]$inc.giftsEarned
                            }
                            if ($inc.name) { $existing.name = $inc.name }
                            if ($inc.memberId -and -not $existing.memberId) { $existing.memberId = $inc.memberId }
                            if ($inc.lastStampDate) { $existing | Add-Member -NotePropertyName "lastStampDate" -NotePropertyValue $inc.lastStampDate -Force }

                            if ($inc.history) {
                                $mergedHist = @()
                                if ($existing.history) { $mergedHist += $existing.history }
                                foreach ($h in $inc.history) {
                                    $alreadyHas = $false
                                    foreach ($eh in $mergedHist) {
                                        if ($eh.note -eq $h.note -and $eh.date -eq $h.date) {
                                            $alreadyHas = $true
                                            break
                                        }
                                    }
                                    if (-not $alreadyHas) { $mergedHist += $h }
                                }
                                $existing.history = $mergedHist
                            }
                            $existing | Add-Member -NotePropertyName "lastUpdated" -NotePropertyValue ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()) -Force
                            $currentUsers[$foundIdx] = $existing
                        } else {
                            $inc | Add-Member -NotePropertyName "lastUpdated" -NotePropertyValue ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()) -Force
                            [void]$currentUsers.Add($inc)
                        }
                    }

                    Save-JsonFile $dataFile $currentUsers
                    Send-JsonResponse $res 200 @{ success = $true; count = $currentUsers.Count; customers = $currentUsers }
                } catch {
                    Send-JsonResponse $res 400 @{ success = $false; error = $_.Exception.Message }
                }
                continue
            }
        }

        # --- REST API: /api/customer/delete (Delete a customer by phone) ---
        if ($path -eq "/api/customer/delete") {
            if ($req.HttpMethod -eq "POST" -or $req.HttpMethod -eq "DELETE") {
                $body = Read-RequestBody $req
                try {
                    $delObj = $body | ConvertFrom-Json
                    $phoneToDel = [string]$delObj.phone
                    $currentUsers = Load-JsonFile $dataFile
                    $filtered = New-Object System.Collections.ArrayList
                    foreach ($u in $currentUsers) {
                        if ($u.phone -ne $phoneToDel) {
                            [void]$filtered.Add($u)
                        }
                    }
                    Save-JsonFile $dataFile $filtered

                    # Persist into deleted_phones.json to block future resyncs
                    $delPhones = Load-JsonFile $deletedFile
                    if (-not ($delPhones -contains $phoneToDel)) {
                        [void]$delPhones.Add($phoneToDel)
                        Save-JsonFile $deletedFile $delPhones
                    }

                    Send-JsonResponse $res 200 @{ success = $true; remaining = $filtered.Count }
                } catch {
                    Send-JsonResponse $res 400 @{ success = $false; error = $_.Exception.Message }
                }
                continue
            }
        }

        # --- REST API: /api/stamp-request (Create 2nd visit approval request) ---
        if ($path -eq "/api/stamp-request") {
            if ($req.HttpMethod -eq "POST") {
                $body = Read-RequestBody $req
                try {
                    $reqObj = $body | ConvertFrom-Json
                    $requests = Load-JsonFile $requestsFile

                    $id = "req_" + ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()) + "_" + (Get-Random -Minimum 1000 -Maximum 9999)
                    $timeStr = (Get-Date).ToString("hh:mm tt")
                    $dateStr = (Get-Date).ToString("dd MMM yyyy")

                    $newReq = [PSCustomObject]@{
                        id = $id
                        phone = $reqObj.phone
                        name = $reqObj.name
                        memberId = $reqObj.memberId
                        currentStamps = [int]$reqObj.currentStamps
                        timeStr = $timeStr
                        dateStr = $dateStr
                        timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
                        status = "pending"
                    }

                    # Remove older pending requests for same phone
                    for ($k = $requests.Count - 1; $k -ge 0; $k--) {
                        if ($requests[$k].phone -eq $reqObj.phone -and $requests[$k].status -eq "pending") {
                            $requests.RemoveAt($k)
                        }
                    }

                    [void]$requests.Add($newReq)
                    Save-JsonFile $requestsFile $requests

                    Send-JsonResponse $res 200 @{ success = $true; requestId = $id; status = "pending" }
                } catch {
                    Send-JsonResponse $res 400 @{ success = $false; error = $_.Exception.Message }
                }
                continue
            }
        }

        # --- REST API: /api/stamp-requests (Owner fetches pending requests) ---
        if ($path -eq "/api/stamp-requests") {
            if ($req.HttpMethod -eq "GET") {
                $requests = Load-JsonFile $requestsFile
                # Filter to only pending requests from the last 12 hours
                $cutoff = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - (12 * 60 * 60 * 1000)
                $activePending = @()
                foreach ($r in $requests) {
                    if ($r.status -eq "pending" -and $r.timestamp -ge $cutoff) {
                        $activePending += $r
                    }
                }
                Send-JsonResponse $res 200 $activePending
                continue
            }
        }

        # --- REST API: /api/stamp-request/resolve (Owner approves or declines) ---
        if ($path -eq "/api/stamp-request/resolve") {
            if ($req.HttpMethod -eq "POST") {
                $body = Read-RequestBody $req
                try {
                    $resObj = $body | ConvertFrom-Json
                    $requests = Load-JsonFile $requestsFile
                    $foundReq = $null

                    foreach ($r in $requests) {
                        if ($r.id -eq $resObj.requestId) {
                            $r.status = $resObj.action  # "approved" or "declined"
                            $foundReq = $r
                            break
                        }
                    }

                    if ($foundReq -and $resObj.action -eq "approved") {
                        # Add stamp to customer in database
                        $currentUsers = Load-JsonFile $dataFile
                        foreach ($u in $currentUsers) {
                            if ($u.phone -eq $foundReq.phone) {
                                if ([int]$u.stamps -lt 6) {
                                    $u.stamps = [int]$u.stamps + 1
                                    $stampNum = $u.stamps
                                    $stampTime = (Get-Date).ToString("HH:mm")
                                    $stampDate = (Get-Date).ToString("dd MMM")
                                    $todayIso = (Get-Date).ToString("yyyy-MM-dd")

                                    $newHist = [PSCustomObject]@{
                                        date = "$stampDate, $stampTime"
                                        type = "stamp"
                                        note = "Store Purchase (2nd Visit Cashier Approved) - Tick #$stampNum of 6 Collected"
                                    }
                                    $histList = @($newHist)
                                    if ($u.history) { $histList += $u.history }
                                    $u.history = $histList
                                    $u | Add-Member -NotePropertyName "lastStampDate" -NotePropertyValue $todayIso -Force
                                    $u | Add-Member -NotePropertyName "lastUpdated" -NotePropertyValue ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()) -Force
                                }
                                break
                            }
                        }
                        Save-JsonFile $dataFile $currentUsers
                    }

                    Save-JsonFile $requestsFile $requests
                    Send-JsonResponse $res 200 @{ success = $true; status = $resObj.action }
                } catch {
                    Send-JsonResponse $res 400 @{ success = $false; error = $_.Exception.Message }
                }
                continue
            }
        }

        # --- REST API: /api/stamp-request/status (Customer polling status) ---
        if ($path -eq "/api/stamp-request/status") {
            $reqId = $req.QueryString["id"]
            if ($reqId) {
                $requests = Load-JsonFile $requestsFile
                $status = "not_found"
                foreach ($r in $requests) {
                    if ($r.id -eq $reqId) {
                        $status = $r.status
                        break
                    }
                }
                Send-JsonResponse $res 200 @{ requestId = $reqId; status = $status }
            } else {
                Send-JsonResponse $res 400 @{ error = "Missing id parameter" }
            }
            continue
        }

        # --- REST API: /api/verify-cashier-pin ---
        if ($path -eq "/api/verify-cashier-pin") {
            if ($req.HttpMethod -eq "POST") {
                $body = Read-RequestBody $req
                $parsed = $body | ConvertFrom-Json
                # Cashier PIN default is 1234
                $isValid = ($parsed.pin -eq "1234")
                Send-JsonResponse $res 200 @{ valid = $isValid }
                continue
            }
        }

        # --- REST API: /api/tunnel (Returns active live Cloudflare tunnel URL & LAN info) ---
        if ($path -eq "/api/tunnel") {
            $tunnelFile = Join-Path $root "data\tunnel_url.txt"
            $tunnelUrl = ""
            $isTunnelRunning = [bool](Get-Process -Name cloudflared -ErrorAction SilentlyContinue)
            if (Test-Path $tunnelFile) {
                try {
                    $tunnelUrl = ([System.IO.File]::ReadAllText($tunnelFile, [System.Text.Encoding]::UTF8)).Trim()
                } catch {}
            }
            if (-not $isTunnelRunning) {
                $tunnelUrl = ""
            }

            # Detect primary Wi-Fi / Local Network IPv4 Address
            $lanIp = ""
            try {
                $lanIp = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.InterfaceAlias -notmatch "Loopback|vEthernet" -and $_.IPAddress -notmatch "^169\.254\." } | Select-Object -ExpandProperty IPAddress -First 1)
            } catch {}
            $lanUrl = if ($lanIp) { "http://${lanIp}:${Port}" } else { "" }

            Send-JsonResponse $res 200 @{
                active = (-not [string]::IsNullOrEmpty($tunnelUrl) -and $isTunnelRunning)
                url = $tunnelUrl
                lanIp = $lanIp
                lanUrl = $lanUrl
            }
            continue
        }

        # --- REST API: /api/version (Returns or updates latest app version) ---
        if ($path -eq "/api/version") {
            $verFile = Join-Path $root "data\version.json"
            if ($req.HttpMethod -eq "POST") {
                try {
                    $body = Read-RequestBody $req
                    $parsed = $body | ConvertFrom-Json
                    if ($null -ne $parsed -and $null -ne $parsed.version) {
                        Save-JsonFile $verFile $parsed
                        Send-JsonResponse $res 200 @{ success = $true; version = $parsed.version; message = "Version updated successfully" }
                    } else {
                        Send-JsonResponse $res 400 @{ error = "Invalid version payload" }
                    }
                } catch {
                    Send-JsonResponse $res 500 @{ error = "Failed to update version: $_" }
                }
                continue
            }
            if (Test-Path $verFile) {
                try {
                    $raw = [System.IO.File]::ReadAllText($verFile, [System.Text.Encoding]::UTF8)
                    $verObj = $raw | ConvertFrom-Json
                    Send-JsonResponse $res 200 $verObj
                } catch {
                    Send-JsonResponse $res 200 @{ version = "1.5.0"; versionCode = 6; notes = "Loyalty Pass" }
                }
            } else {
                Send-JsonResponse $res 200 @{ version = "1.5.0"; versionCode = 6; notes = "Loyalty Pass" }
            }
            continue
        }

        # --- Static File Serving ---
        $urlPath = $req.Url.LocalPath.TrimStart('/')
        if ([string]::IsNullOrEmpty($urlPath)) {
            $urlPath = "index.html"
        }

        $urlPathNorm = $urlPath -replace '/', '\'
        $filePath = Join-Path $root $urlPathNorm

        if (Test-Path $filePath -PathType Container) {
            if (-not $req.Url.LocalPath.EndsWith('/')) {
                $res.StatusCode = 301
                $res.AddHeader("Location", $req.Url.LocalPath + "/" + $req.Url.Query)
                $res.OutputStream.Close()
                continue
            }
            $filePath = Join-Path $filePath "index.html"
        }

        if (Test-Path $filePath -PathType Leaf) {
            $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
            $mime = "application/octet-stream"
            if ($mimeTypes.ContainsKey($ext)) {
                $mime = $mimeTypes[$ext]
            }
            $res.ContentType = $mime
            $res.AddHeader("Access-Control-Allow-Origin", "*")
            if ($ext -eq ".ico" -or $ext -eq ".png" -or $ext -eq ".html") {
                $res.AddHeader("Cache-Control", "no-cache, no-store, must-revalidate")
            } else {
                $res.AddHeader("Cache-Control", "no-cache")
            }

            if ($ext -eq ".apk") {
                $filename = [System.IO.Path]::GetFileName($filePath)
                $res.AddHeader("Content-Disposition", "attachment; filename=`"$filename`"")
                $res.AddHeader("Accept-Ranges", "bytes")

                $fileInfo = New-Object System.IO.FileInfo($filePath)
                $res.ContentLength64 = $fileInfo.Length
                if ($req.HttpMethod -ne "HEAD") {
                    $fs = [System.IO.File]::OpenRead($filePath)
                    $buffer = New-Object byte[] 65536
                    try {
                        while (($bytesRead = $fs.Read($buffer, 0, $buffer.Length)) -gt 0) {
                            $res.OutputStream.Write($buffer, 0, $bytesRead)
                        }
                    } finally {
                        $fs.Close()
                    }
                }
            } else {
                $bytes = [System.IO.File]::ReadAllBytes($filePath)
                $res.ContentLength64 = $bytes.Length
                if ($req.HttpMethod -ne "HEAD") {
                    $res.OutputStream.Write($bytes, 0, $bytes.Length)
                }
            }
        } else {
            $res.StatusCode = 404
            $msg = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found: $urlPath")
            $res.ContentLength64 = $msg.Length
            if ($req.HttpMethod -ne "HEAD") {
                $res.OutputStream.Write($msg, 0, $msg.Length)
            }
        }
        $res.OutputStream.Close()
    } catch {
        # Catch and ignore aborted connections so server never crashes
    }
}
