$files = @(
    "src/canvas/left/pane.tsx",
    "src/canvas/tab/analyze/ribbon.tsx",
    "src/components/ui/validation-notice.tsx",
    "src/lib/maestro-log-sanitize.ts",
    "src/lib/shacl-validation-report.ts"
)

foreach ($file in $files) {
    $content = [System.IO.File]::ReadAllText((Resolve-Path $file))

    # Remove trailing spaces and tabs
    $content = [regex]::Replace($content, '(?m)[ \t]+$', '')

    # Ensure exactly one final newline
    $content = $content.TrimEnd("`r", "`n") + "`n"

    [System.IO.File]::WriteAllText(
        (Resolve-Path $file),
        $content,
        [System.Text.UTF8Encoding]::new($false)
    )
}