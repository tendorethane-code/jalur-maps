package io.github.tendorethane_code.jalur;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;

import com.google.androidbrowserhelper.trusted.LauncherActivity;

import java.util.Collections;
import java.util.Map;

/**
 * The Trusted Web Activity launcher, plus:
 * - a geo: link (a location opened from WhatsApp or another app) becomes
 *   https://…/jalur-maps/?text=geo:…, so the web app's share handling sets it as the destination.
 *   LauncherActivity fills %s with the URL-encoded geo: URI;
 * - after a crash (CrashReport), the next launch shows the error instead of the site.
 */
public class JalurLauncherActivity extends LauncherActivity {
    @Override
    protected Map<String, Uri> getProtocolHandlers() {
        return Collections.singletonMap("geo", Uri.parse(BuildConfig.APP_URL + "?text=%s"));
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        boolean report = CrashReport.exists(this);
        try {
            super.onCreate(savedInstanceState);
        } catch (RuntimeException e) {
            // LauncherActivity calls Activity.onCreate first, so the activity is valid here.
            CrashReport.save(this, Thread.currentThread(), e);
            report = true;
        }
        if (report) {
            startActivity(new Intent(this, CrashReportActivity.class));
            finish();
        }
    }

    @Override
    protected boolean shouldLaunchImmediately() {
        // Don't open the site behind the error report.
        return !CrashReport.exists(this) && super.shouldLaunchImmediately();
    }
}
