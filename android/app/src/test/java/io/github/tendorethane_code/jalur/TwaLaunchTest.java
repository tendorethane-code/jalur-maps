package io.github.tendorethane_code.jalur;

import static org.junit.Assert.assertNotNull;
import static org.robolectric.Shadows.shadowOf;

import android.app.Application;
import android.content.ComponentName;
import android.content.Intent;
import android.content.IntentFilter;
import android.net.Uri;
import android.os.Bundle;
import android.os.IBinder;

import androidx.browser.customtabs.CustomTabsService;
import androidx.browser.customtabs.CustomTabsSessionToken;

import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import org.robolectric.shadows.ShadowLooper;
import org.robolectric.shadows.ShadowPackageManager;

import java.util.List;

/**
 * The phone has Chrome, so the launcher takes the Trusted Web Activity path, which LaunchTest
 * (no browser at all) never reaches. Here a fake "Chrome" offers a browser activity and a
 * Custom Tabs service that supports TWAs, so the whole launch runs on the JVM.
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class TwaLaunchTest {
    private static final String CHROME = "com.android.chrome";

    /** A Custom Tabs service that says yes to everything. */
    public static class FakeChromeService extends CustomTabsService {
        @Override protected boolean warmup(long flags) { return true; }
        @Override protected boolean newSession(CustomTabsSessionToken token) { return true; }
        @Override protected boolean mayLaunchUrl(CustomTabsSessionToken t, Uri u, Bundle b, List<Bundle> l) { return true; }
        @Override protected Bundle extraCommand(String c, Bundle a) { return null; }
        @Override protected boolean updateVisuals(CustomTabsSessionToken t, Bundle b) { return true; }
        @Override protected boolean requestPostMessageChannel(CustomTabsSessionToken t, Uri u) { return false; }
        @Override protected int postMessage(CustomTabsSessionToken t, String m, Bundle e) { return 0; }
        @Override protected boolean validateRelationship(CustomTabsSessionToken t, int r, Uri o, Bundle e) { return true; }
        @Override protected boolean receiveFile(CustomTabsSessionToken t, Uri u, int p, Bundle e) { return true; }
    }

    @Before
    public void fakeChrome() {
        Application app = org.robolectric.RuntimeEnvironment.getApplication();
        ShadowPackageManager pm = shadowOf(app.getPackageManager());

        ComponentName browser = new ComponentName(CHROME, CHROME + ".Main");
        pm.addActivityIfNotPresent(browser);
        IntentFilter view = new IntentFilter(Intent.ACTION_VIEW);
        view.addCategory(Intent.CATEGORY_BROWSABLE);
        view.addCategory(Intent.CATEGORY_DEFAULT);
        view.addDataScheme("http");
        view.addDataScheme("https");
        pm.addIntentFilterForActivity(browser, view);

        ComponentName service = new ComponentName(CHROME, CHROME + ".CustomTabsConnectionService");
        pm.addServiceIfNotPresent(service);
        IntentFilter tabs = new IntentFilter("android.support.customtabs.action.CustomTabsService");
        tabs.addCategory("androidx.browser.trusted.category.TrustedWebActivities");
        pm.addIntentFilterForService(service, tabs);

        IBinder binder = new FakeChromeService().onBind(new Intent());
        Intent bind = new Intent("android.support.customtabs.action.CustomTabsService").setPackage(CHROME);
        shadowOf(app).setComponentNameAndServiceForBindServiceForIntent(bind, service, binder);
    }

    private Intent launch(Intent intent) {
        Robolectric.buildActivity(JalurLauncherActivity.class, intent).create().start().resume();
        ShadowLooper.idleMainLooper();
        Intent started = shadowOf(org.robolectric.RuntimeEnvironment.getApplication()).getNextStartedActivity();
        System.out.println("started: " + started + (started != null ? " data=" + started.getData() : ""));
        return started;
    }

    @Test
    public void iconLaunchDoesNotCrash() {
        // Robolectric doesn't complete the Custom Tabs binding, so nothing is started here; the
        // point is that the TWA path up to launching doesn't throw.
        launch(new Intent(Intent.ACTION_MAIN));
    }

    @Test
    public void geoLinkOpensJalurWithIt() {
        assertNotNull(launch(new Intent(Intent.ACTION_VIEW, Uri.parse("geo:-6.17,106.71?q=-6.17,106.71(Rumah)"))));
    }

    @Test
    public void sharedTextOpensJalurWithIt() {
        assertNotNull(launch(new Intent(Intent.ACTION_SEND).setType("text/plain")
                .putExtra(Intent.EXTRA_TEXT, "https://maps.app.goo.gl/abc")));
    }
}
