$ErrorActionPreference = 'SilentlyContinue'
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
"CPU_NAME      : " + $cpu.Name
"CPU_CORES     : " + $cpu.NumberOfCores
"CPU_THREADS   : " + $cpu.NumberOfLogicalProcessors
"CPU_MAX_MHZ   : " + $cpu.MaxClockSpeed
"L2_CACHE_KB   : " + $cpu.L2CacheSize
"L3_CACHE_KB   : " + $cpu.L3CacheSize
$cs = Get-CimInstance Win32_ComputerSystem
"RAM_GB        : " + [math]::Round($cs.TotalPhysicalMemory/1GB,1)
"--- GPU"
Get-CimInstance Win32_VideoController | ForEach-Object {
  "GPU           : " + $_.Name + " | VRAM(MB)=" + [math]::Round($_.AdapterRAM/1MB,0) + " | drv=" + $_.DriverVersion + " | status=" + $_.Status
}
"--- DISK"
Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='D:'" | ForEach-Object {
  "D_FREE_GB     : " + [math]::Round($_.FreeSpace/1GB,1) + " / total " + [math]::Round($_.Size/1GB,1)
}
"--- OS"
"OS            : " + (Get-CimInstance Win32_OperatingSystem).Caption + " build " + (Get-CimInstance Win32_OperatingSystem).BuildNumber
