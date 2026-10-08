; Personnalisation de l'installateur : choix du raccourci sur le Bureau (après le choix du dossier d'installation)
!macro customPageAfterChangeDir
  !include nsDialogs.nsh
  !include LogicLib.nsh
  Var /GLOBAL AgoaChk
  Var /GLOBAL AgoaWant
  Page custom AgoaShortcutPage AgoaShortcutLeave
  Function AgoaShortcutPage
    ${if} ${isUpdated}
      Abort
    ${endif}
    !insertmacro MUI_HEADER_TEXT "Raccourcis" "Choisissez les raccourcis à créer."
    nsDialogs::Create 1018
    Pop $0
    ${NSD_CreateCheckbox} 0 12u 100% 12u "Créer un raccourci sur le Bureau"
    Pop $AgoaChk
    ${NSD_Check} $AgoaChk
    nsDialogs::Show
  FunctionEnd
  Function AgoaShortcutLeave
    ${NSD_GetState} $AgoaChk $AgoaWant
  FunctionEnd
!macroend

!macro customInstall
  ${if} $AgoaWant == "1"
    CreateShortCut "$DESKTOP\${SHORTCUT_NAME}.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0
  ${endif}
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
    Delete "$DESKTOP\${SHORTCUT_NAME}.lnk"
  ${endif}
!macroend
