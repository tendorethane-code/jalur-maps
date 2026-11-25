package io.github.tendorethane_code.jalur;

import android.content.Intent;
import android.net.Uri;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;
import static org.robolectric.Shadows.shadowOf;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

/**
 * Starts the launcher the way the phone does (icon, WhatsApp geo: link, Google Maps share).
 * The first APK crashed on the owner's phone right at launch; this reproduces launches on the JVM.
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class LaunchTest {
    @Test
    public void launchFromIcon() {
        Robolectric.buildActivity(JalurLauncherActivity.class, new Intent(Intent.ACTION_MAIN)).create().start().resume();
    }

    @Test
    public void launchFromGeoLink() {
        Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse("geo:-6.17,106.71?q=-6.17,106.71(Rumah)"));
        Robolectric.buildActivity(JalurLauncherActivity.class, i).create().start().resume();
    }

    @Test
    public void launchFromShare() {
        Intent i = new Intent(Intent.ACTION_SEND).setType("text/plain")
                .putExtra(Intent.EXTRA_TEXT, "https://maps.app.goo.gl/abc");
        Robolectric.buildActivity(JalurLauncherActivity.class, i).create().start().resume();
    }

    @Test
    public void afterACrashTheNextLaunchShowsTheReport() {
        android.app.Application app = org.robolectric.RuntimeEnvironment.getApplication();
        CrashReport.save(app, Thread.currentThread(), new IllegalStateException("contoh error"));
        assertTrue(CrashReport.exists(app));
        assertTrue(CrashReport.read(app).contains("contoh error"));

        Robolectric.buildActivity(JalurLauncherActivity.class, new Intent(Intent.ACTION_MAIN)).create();
        Intent next = shadowOf(app).getNextStartedActivity();
        assertNotNull(next);
        assertEquals(CrashReportActivity.class.getName(), next.getComponent().getClassName());

        // The report screen opens, and "Coba buka lagi" clears it.
        org.robolectric.android.controller.ActivityController<CrashReportActivity> report =
                Robolectric.buildActivity(CrashReportActivity.class).create().start().resume();
        android.view.ViewGroup root = (android.view.ViewGroup) report.get().findViewById(android.R.id.content);
        android.view.ViewGroup layout = (android.view.ViewGroup) root.getChildAt(0);
        android.view.ViewGroup buttons = (android.view.ViewGroup) layout.getChildAt(2);
        buttons.getChildAt(1).performClick();
        assertFalse(CrashReport.exists(app));
    }

    /**
     * LauncherActivity calls setComponentEnabledSetting on these every launch; on a real phone an
     * undeclared one crashes the app (uji1/uji2), while Robolectric doesn't check. So check here.
     */
    @Test
    public void libraryComponentsAreDeclared() throws Exception {
        android.app.Application app = org.robolectric.RuntimeEnvironment.getApplication();
        for (String name : new String[] {
                "com.google.androidbrowserhelper.trusted.ManageDataLauncherActivity",
                "io.github.tendorethane_code.jalur.CrashReportActivity",
        }) {
            assertNotNull(name, app.getPackageManager().getActivityInfo(
                    new android.content.ComponentName(app.getPackageName(), name), 0));
        }
    }
}
