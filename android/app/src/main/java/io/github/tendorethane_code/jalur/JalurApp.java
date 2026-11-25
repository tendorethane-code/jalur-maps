package io.github.tendorethane_code.jalur;

import android.app.Application;
import android.content.Context;

/**
 * Records any crash in this process (CrashReport) so the next launch can show it instead of
 * silently dying again. Installed in attachBaseContext, before content providers start, so a
 * crash during start-up is caught too. The first APK crashed on the owner's phone and could not
 * be reproduced here (no emulator, Robolectric launches fine): this is how we see why.
 */
public class JalurApp extends Application {
    @Override
    protected void attachBaseContext(Context base) {
        super.attachBaseContext(base);
        final Thread.UncaughtExceptionHandler previous = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler((thread, error) -> {
            CrashReport.save(base, thread, error);
            if (previous != null) previous.uncaughtException(thread, error);
        });
    }
}
