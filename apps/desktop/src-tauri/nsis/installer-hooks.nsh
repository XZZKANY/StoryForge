; 0.2.0 起包里不再有 Python sidecar；从旧版覆盖安装会把它留在安装目录里，
; 新卸载器也不认识这个文件（卸载后目录删不干净），所以安装后、卸载前各删一次。
!macro NSIS_HOOK_POSTINSTALL
  Delete "$INSTDIR\storyforge-api.exe"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  Delete "$INSTDIR\storyforge-api.exe"
!macroend
