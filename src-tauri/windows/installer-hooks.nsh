; Hooks the app's NSIS installer runs (bundle.windows.nsis.installerHooks).

; An installation from before the app identifier changed keeps its folder under the earlier publisher's key
; (Software\iyulab\<product>). When this identifier's key names no folder yet and the install would go to the
; default folder — a first install over the earlier version, by hand or by the app updating itself — it goes where
; the earlier version is, so the one installation is replaced rather than a second left beside it. A folder chosen
; by hand is kept. Runs at the start of the install section, before any file is written.
!macro NSIS_HOOK_PREINSTALL
  ReadRegStr $R8 SHCTX "${MANUPRODUCTKEY}" ""
  ${If} $R8 == ""
  ${AndIf} $INSTDIR == "$LOCALAPPDATA\${PRODUCTNAME}"
    ReadRegStr $R9 SHCTX "Software\iyulab\${PRODUCTNAME}" ""
    ${If} $R9 != ""
    ${AndIf} ${FileExists} "$R9\${MAINBINARYNAME}.exe"
      StrCpy $INSTDIR $R9
      SetOutPath $INSTDIR
    ${EndIf}
  ${EndIf}
!macroend
