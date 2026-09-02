!macro customInit
  ; Reuse the Squirrel.Windows per-user directory during the first NSIS upgrade.
  ; Later NSIS upgrades use the installation directory stored by the installer.
  IfFileExists "$LOCALAPPDATA\WLSAPlus\Update.exe" 0 done
  StrCpy $INSTDIR "$LOCALAPPDATA\WLSAPlus"
  done:
!macroend
