$ErrorActionPreference = 'Stop'
$request = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:SOP_PROOF_CLEANUP_REQUEST)) | ConvertFrom-Json
Add-Type -TypeDefinition @'
using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.Win32.SafeHandles;

public static class SopProofCleanup
{
    const uint ReadAttributes = 0x80, DeleteAccess = 0x10000, Directory = 0x10, ReparsePoint = 0x400;
    const uint NoFollow = 0x00200000, DirectoryHandle = 0x02000000;
    static readonly Regex Proof = new Regex(@"\ASOP校样-(?:[\p{L}\p{N} _().（）-]{1,40}-)?[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\.docx\z");

    [StructLayout(LayoutKind.Sequential)]
    struct FileIdentity
    {
        public uint Attributes;
        public System.Runtime.InteropServices.ComTypes.FILETIME Created, Accessed, Written;
        public uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
    }

    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern SafeFileHandle CreateFile(string name, uint access, uint share, IntPtr security,
        uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool GetFileInformationByHandle(SafeFileHandle file, out FileIdentity identity);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern uint GetFinalPathNameByHandle(SafeFileHandle file, StringBuilder name, uint length, uint flags);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern uint GetFileAttributes(string name);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool SetFileInformationByHandle(SafeFileHandle file, int kind, ref byte delete, uint size);
    [DllImport("shlwapi.dll", CharSet=CharSet.Unicode)]
    static extern int AssocQueryString(uint flags, uint kind, string association, string verb, StringBuilder name, ref uint size);

    static string Extended(string name)
    {
        return name.StartsWith(@"\\") ? @"\\?\UNC\" + name.Substring(2) : @"\\?\" + name;
    }

    static bool IsExact(SafeFileHandle handle, string name, bool directory)
    {
        FileIdentity identity;
        if (handle.IsInvalid || !GetFileInformationByHandle(handle, out identity)) return false;
        if ((identity.Attributes & ReparsePoint) != 0 || ((identity.Attributes & Directory) != 0) != directory) return false;
        if (!directory && identity.Links != 1) return false;
        StringBuilder actual = new StringBuilder(32768);
        uint length = GetFinalPathNameByHandle(handle, actual, (uint)actual.Capacity, 0);
        return length > 0 && length < actual.Capacity &&
            String.Equals(actual.ToString(), Extended(name), StringComparison.OrdinalIgnoreCase);
    }

    static bool ExistsOrUncertain(string name)
    {
        if (GetFileAttributes(name) != UInt32.MaxValue) return true;
        int error = Marshal.GetLastWin32Error();
        return error != 2 && error != 3;
    }

    static bool HeldByOffice(string root, string name)
    {
        return ExistsOrUncertain(Path.Combine(root,"~$" + name.Substring(2))) ||
            ExistsOrUncertain(Path.Combine(root,"~$" + name));
    }

    public static bool CanSweepUnobserved()
    {
        StringBuilder executable = new StringBuilder(32768);
        uint size = (uint)executable.Capacity;
        if (AssocQueryString(0, 2, ".docx", "open", executable, ref size) != 0) return false;
        string editor = Path.GetFileNameWithoutExtension(executable.ToString()).ToLowerInvariant();
        if (editor != "wps" && editor != "winword") return false;
        foreach (string processName in new string[] { "wps", "winword" })
        {
            Process[] processes = Process.GetProcessesByName(processName);
            foreach (Process process in processes) process.Dispose();
            if (processes.Length != 0) return false;
        }
        return true;
    }

    static bool DeleteExact(string file, Func<bool> protectedByOwner)
    {
        using (SafeFileHandle handle = CreateFile(Extended(file), ReadAttributes | DeleteAccess, 0, IntPtr.Zero, 3, NoFollow, IntPtr.Zero))
        {
            if (handle.IsInvalid) return Marshal.GetLastWin32Error() == 2;
            if (!IsExact(handle, file, false) || protectedByOwner()) return false;
            byte remove = 1;
            return SetFileInformationByHandle(handle, 4, ref remove, 1);
        }
    }

    public static void Sweep(string root, string name, bool stale)
    {
        if (!Proof.IsMatch(name)) return;
        root = Path.GetFullPath(root);
        using (SafeFileHandle parent = CreateFile(Extended(root), ReadAttributes, 1, IntPtr.Zero, 3, NoFollow | DirectoryHandle, IntPtr.Zero))
        {
            if (!IsExact(parent, root, true)) return;
            string file = Path.Combine(root, name), managed = file + ".sop-proof";
            using (SafeFileHandle lease = CreateFile(Extended(managed), ReadAttributes | DeleteAccess, 0, IntPtr.Zero, 3, NoFollow, IntPtr.Zero))
            {
                if (!IsExact(lease, managed, false)) return;
                if (!DeleteExact(file, () => stale ? !CanSweepUnobserved() : HeldByOffice(root, name))) return;
                DeleteExact(file + ".sop-opened", () => false);
                byte remove = 1;
                SetFileInformationByHandle(lease, 4, ref remove, 1);
            }
        }
    }
}
'@
$canSweepUnobserved = $false
if ($request.candidates | Where-Object { $_.stale }) {
    $canSweepUnobserved = [SopProofCleanup]::CanSweepUnobserved()
}
foreach ($candidate in $request.candidates) {
    if (!$candidate.stale -or $canSweepUnobserved) {
        [SopProofCleanup]::Sweep([string]$request.root, [string]$candidate.name, [bool]$candidate.stale)
    }
}
