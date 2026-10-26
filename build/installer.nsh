; Extra NSIS steps (electron-builder picks up build/installer.nsh on its own).
;
; On a real uninstall, ask whether to delete Pi Desktop's own data. Updates and
; silent uninstalls keep it. pi's shared config (~/.pi/agent: logins, models,
; CLI sessions) and custom worktree folders are never touched.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    IfSilent pi_keep_data
    ReadEnvStr $0 "PI_DESKTOP_HOME"
    StrCmp $0 "" 0 pi_have_dir
      StrCpy $0 "$PROFILE\.pi-desktop"
    pi_have_dir:
    IfFileExists "$0\*.*" 0 pi_keep_data
      MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 \
        "Also delete Pi Desktop's data?$\r$\n$\r$\n$0$\r$\n$\r$\nThis removes settings, session list, caches, demo files and the default worktrees folder (unmerged work inside it is lost). pi's own config in ~\.pi\agent is kept." \
        IDNO pi_keep_data
      RMDir /r "$0"
      RMDir /r "$APPDATA\${APP_FILENAME}"
    pi_keep_data:
  ${endIf}
!macroend
