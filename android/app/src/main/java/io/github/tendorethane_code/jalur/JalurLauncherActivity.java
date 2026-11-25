package io.github.tendorethane_code.jalur;

import android.net.Uri;

import com.google.androidbrowserhelper.trusted.LauncherActivity;

import java.util.Collections;
import java.util.Map;

/**
 * The Trusted Web Activity launcher, plus one thing: a geo: link (a location opened from
 * WhatsApp or another app) becomes https://…/jalur-maps/?text=geo:…, so the web app's share
 * handling sets it as the destination. LauncherActivity fills %s with the URL-encoded geo: URI.
 */
public class JalurLauncherActivity extends LauncherActivity {
    @Override
    protected Map<String, Uri> getProtocolHandlers() {
        return Collections.singletonMap("geo", Uri.parse(BuildConfig.APP_URL + "?text=%s"));
    }
}
