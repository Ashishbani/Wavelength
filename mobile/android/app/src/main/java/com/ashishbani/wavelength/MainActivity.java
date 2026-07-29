package com.ashishbani.wavelength;

import android.os.Bundle;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // The web Wake Lock API isn't available inside the WebView, so keep the
        // screen on while the app is in the foreground — otherwise the screen
        // sleeps mid-song and YouTube playback pauses. (Uploaded "My Music"
        // tracks keep playing even in the background; this is for YouTube.)
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        // A WebView scales text by the device's system font-size setting, which
        // mobile browsers do NOT do for websites. That made the app's header
        // collide and clip on devices with larger fonts while the same page was
        // fine in mobile Chrome. Pin text zoom so the app renders the layout it
        // was designed and tested at (the UI already uses comfortable sizes).
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().getSettings().setTextZoom(100);
        }
    }
}
