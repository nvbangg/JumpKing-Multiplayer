param(
    [string]$MySqlHome,
    [string]$JavaHome = $env:JAVA_HOME,
    [switch]$Web,
    [switch]$DatabaseRecovery,
    [string]$IntegrationTest
)
$ErrorActionPreference = 'Stop'
$workspace = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
if (-not $MySqlHome) {
    if ($env:MYSQL_HOME -and (Test-Path $env:MYSQL_HOME)) {
        $MySqlHome = $env:MYSQL_HOME
    } else {
        $service = Get-CimInstance Win32_Service -Filter "Name LIKE 'MySQL%'" -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($service -and $service.PathName) {
            $exePath = if ($service.PathName -match '^"([^"]+)"') { $matches[1] } else { ($service.PathName -split ' ')[0] }
            if ($exePath -and (Test-Path $exePath)) {
                $MySqlHome = (Resolve-Path (Join-Path (Split-Path (Split-Path $exePath)) '.')).Path
            }
        }
        if (-not $MySqlHome) {
            $candidates = @(
                'C:\Program Files\MySQL\MySQL Server 9.6',
                'C:\Program Files\MySQL\MySQL Server 8.4',
                'C:\Program Files\MySQL\MySQL Server 8.0'
            )
            foreach ($candidate in $candidates) {
                if (Test-Path (Join-Path $candidate 'bin\mysqld.exe')) {
                    $MySqlHome = $candidate
                    break
                }
            }
        }
    }
}
if (-not $MySqlHome -or -not (Test-Path $MySqlHome)) {
    throw "Không tìm thấy thư mục cài đặt MySQL trên máy. Vui lòng truyền tham số -MySqlHome '<đường dẫn MySQL>'."
}
$testRoot = Join-Path ([IO.Path]::GetTempPath()) 'jumpking-mysql-tests'
$runRoot = Join-Path $testRoot ([guid]::NewGuid().ToString('N'))
$mysqlBase = (Resolve-Path -LiteralPath $MySqlHome).Path
$server = Join-Path $mysqlBase 'bin/mysqld.exe'
$client = Join-Path $mysqlBase 'bin/mysql.exe'
$database = 'jumpking_it_' + [guid]::NewGuid().ToString('N')
$password = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
$oldJava = $env:JAVA_HOME
$oldUrl = $env:JK_TEST_DATABASE_URL
$oldUser = $env:JK_TEST_DATABASE_USERNAME
$oldPassword = $env:JK_TEST_DATABASE_PASSWORD
$oldMysqlPassword = $env:MYSQL_PWD
$process = $null
$locationPushed = $false
try {
    New-Item -ItemType Directory -Path $runRoot -Force | Out-Null
    $data = Join-Path $runRoot 'data'
    $init = Join-Path $runRoot 'initialize.sql'
    $sql = "ALTER USER 'root'@'localhost' IDENTIFIED BY '$password'; CREATE DATABASE $database CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;"
    [IO.File]::WriteAllText($init, $sql)
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
    $listener.Start()
    $port = $listener.LocalEndpoint.Port
    $listener.Stop()
    & $server --no-defaults "--basedir=$mysqlBase" "--datadir=$data" --initialize-insecure --console 2>&1 | Out-File (Join-Path $runRoot 'initialize.log')
    if ($LASTEXITCODE -ne 0) { throw 'MySQL initialization failed; see private test logs.' }
    $config = Join-Path $runRoot 'my.ini'
    $configText = "[mysqld]`nbasedir=$($mysqlBase.Replace('\','/'))`ndatadir=$($data.Replace('\','/'))`nbind-address=127.0.0.1`nport=$port`nmysqlx=0`ninit-file=$($init.Replace('\','/'))`nlog-error=$($runRoot.Replace('\','/'))/server.log`ninnodb-buffer-pool-size=64M`n"
    [IO.File]::WriteAllText($config, $configText)
    $process = Start-Process -FilePath $server -ArgumentList "--defaults-file=`"$config`"" -PassThru -WindowStyle Hidden
    $env:MYSQL_PWD = $password
    $ready = $false
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        if ($process.HasExited) { throw 'Isolated MySQL stopped before becoming ready.' }
        & $client --no-defaults --host=127.0.0.1 "--port=$port" --user=root --silent --execute='SELECT 1' 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) { $ready = $true; break }
        Start-Sleep -Milliseconds 500
    }
    Remove-Item Env:MYSQL_PWD
    if (-not $ready) { throw 'Isolated MySQL startup timed out.' }
    $env:JAVA_HOME = $JavaHome
    $env:JK_TEST_DATABASE_URL = "jdbc:mysql://127.0.0.1:$port/$database`?connectionTimeZone=UTC&forceConnectionTimeZoneToSession=true"
    $env:JK_TEST_DATABASE_USERNAME = 'root'
    $env:JK_TEST_DATABASE_PASSWORD = $password
    Push-Location (Join-Path $workspace 'source/server')
    $locationPushed = $true
    $profiles = if ($Web) { '-Pintegration,web' } else { '-Pintegration' }
    $verificationArguments = @('-B', '-ntp', 'clean', 'verify', $profiles)
    if ($IntegrationTest) { $verificationArguments += "-Dit.test=$IntegrationTest" }
    & .\mvnw.cmd @verificationArguments
    if ($LASTEXITCODE -ne 0) { throw 'Integration verification failed.' }
    if ($DatabaseRecovery) {
        $env:MYSQL_PWD = $password
        $connectionArguments = @('--no-defaults', '--host=127.0.0.1', "--port=$port", '--user=root', '--batch', '--skip-column-names')
        $countsSql = "SELECT 'users',COUNT(*) FROM users UNION ALL SELECT 'play_runs',COUNT(*) FROM play_runs UNION ALL SELECT 'matches',COUNT(*) FROM matches;"
        $countsBefore = & $client @connectionArguments "--database=$database" "--execute=$countsSql"
        if ($LASTEXITCODE -ne 0) { throw 'Could not read recovery fixture counts.' }
        $dump = Join-Path $runRoot 'backup.sql'
        & (Join-Path $mysqlBase 'bin/mysqldump.exe') --no-defaults --host=127.0.0.1 "--port=$port" --user=root --single-transaction --no-tablespaces --set-gtid-purged=OFF --hex-blob "--result-file=$dump" $database
        if ($LASTEXITCODE -ne 0) { throw 'Isolated database backup failed.' }
        & (Join-Path $mysqlBase 'bin/mysqladmin.exe') --no-defaults --host=127.0.0.1 "--port=$port" --user=root shutdown
        if ($LASTEXITCODE -ne 0 -or -not $process.WaitForExit(20000)) { throw 'Isolated database did not stop cleanly.' }
        [IO.File]::WriteAllText($config, ($configText -replace '(?m)^init-file=.*\n', ''))
        $process = Start-Process -FilePath $server -ArgumentList "--defaults-file=`"$config`"" -PassThru -WindowStyle Hidden
        $restarted = $false
        for ($attempt = 0; $attempt -lt 60; $attempt++) {
            if ($process.HasExited) { throw 'Isolated MySQL restart failed.' }
            & $client @connectionArguments --execute='SELECT 1' 2>$null | Out-Null
            if ($LASTEXITCODE -eq 0) { $restarted = $true; break }
            Start-Sleep -Milliseconds 500
        }
        if (-not $restarted) { throw 'Isolated MySQL restart timed out.' }
        $countsAfter = & $client @connectionArguments "--database=$database" "--execute=$countsSql"
        if ($LASTEXITCODE -ne 0 -or ($countsBefore -join "`n") -ne ($countsAfter -join "`n")) { throw 'Counts changed after MySQL restart.' }
        $restoreDatabase = $database + '_restore'
        & $client @connectionArguments "--execute=CREATE DATABASE $restoreDatabase CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;"
        if ($LASTEXITCODE -ne 0) { throw 'Could not create isolated restore database.' }
        # Đọc dump qua stdin; không phụ thuộc lệnh SOURCE của mysql client trong batch mode.
        $restore = Start-Process -FilePath $client -ArgumentList ($connectionArguments + "--database=$restoreDatabase") `
            -RedirectStandardInput $dump -RedirectStandardOutput (Join-Path $runRoot 'restore.log') `
            -RedirectStandardError (Join-Path $runRoot 'restore-error.log') -WindowStyle Hidden -Wait -PassThru
        if ($restore.ExitCode -ne 0) { throw 'Isolated database restore failed.' }
        $restoredCounts = & $client @connectionArguments "--database=$restoreDatabase" "--execute=$countsSql"
        if ($LASTEXITCODE -ne 0 -or ($countsBefore -join "`n") -ne ($restoredCounts -join "`n")) { throw 'Counts changed after restore.' }
        foreach ($table in @('users', 'play_runs', 'matches')) {
            $original = & $client @connectionArguments "--execute=CHECKSUM TABLE $database.$table EXTENDED;"
            if ($LASTEXITCODE -ne 0) { throw 'Original checksum failed.' }
            $restored = & $client @connectionArguments "--execute=CHECKSUM TABLE $restoreDatabase.$table EXTENDED;"
            if ($LASTEXITCODE -ne 0 -or $original.Split("`t")[-1] -ne $restored.Split("`t")[-1]) { throw "Restore checksum differs for $table." }
        }
        Write-Output 'PASS: isolated MySQL restart, backup and restore; all three table counts and checksums match.'
        Remove-Item Env:MYSQL_PWD
    }
}
finally {
    if ($locationPushed) { Pop-Location }
    $env:JAVA_HOME = $oldJava
    $env:JK_TEST_DATABASE_URL = $oldUrl
    $env:JK_TEST_DATABASE_USERNAME = $oldUser
    $env:JK_TEST_DATABASE_PASSWORD = $oldPassword
    try {
        if ($process) {
            $env:MYSQL_PWD = $password
            & (Join-Path $mysqlBase 'bin/mysqladmin.exe') --no-defaults --host=127.0.0.1 "--port=$port" --user=root --connect-timeout=2 shutdown 2>$null | Out-Null
            $process.WaitForExit(20000) | Out-Null
            $remaining = Get-CimInstance Win32_Process -Filter "Name = 'mysqld.exe'" |
                Where-Object { $_.CommandLine -and $_.CommandLine.Contains($config) }
            foreach ($ownedProcess in $remaining) { Stop-Process -Id $ownedProcess.ProcessId -Force }
        }
    } finally { $env:MYSQL_PWD = $oldMysqlPassword }
    $resolvedRun = [IO.Path]::GetFullPath($runRoot)
    $resolvedRoot = [IO.Path]::GetFullPath($testRoot) + [IO.Path]::DirectorySeparatorChar
    if ($resolvedRun.StartsWith($resolvedRoot, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $resolvedRun)) {
        Remove-Item -LiteralPath $resolvedRun -Recurse -Force
    }
}
