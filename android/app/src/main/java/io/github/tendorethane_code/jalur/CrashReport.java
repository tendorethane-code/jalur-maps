package io.github.tendorethane_code.jalur;

import android.content.Context;
import android.os.Build;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.nio.charset.StandardCharsets;

/** The last crash, kept in the app's private files until the owner has seen (and copied) it. */
final class CrashReport {
    private static final String FILE = "last-crash.txt";

    private CrashReport() {}

    static void save(Context context, Thread thread, Throwable error) {
        try {
            StringWriter trace = new StringWriter();
            error.printStackTrace(new PrintWriter(trace));
            String text = "Jalur " + BuildConfig.VERSION_NAME + " (" + BuildConfig.VERSION_CODE + ")\n"
                    + "Android " + Build.VERSION.RELEASE + " (API " + Build.VERSION.SDK_INT + "), "
                    + Build.MANUFACTURER + " " + Build.MODEL + "\n"
                    + "Thread: " + thread.getName() + "\n\n" + trace;
            try (FileOutputStream out = new FileOutputStream(new File(context.getFilesDir(), FILE))) {
                out.write(text.getBytes(StandardCharsets.UTF_8));
            }
        } catch (Throwable ignored) {
            // Never let the crash reporter crash.
        }
    }

    static boolean exists(Context context) {
        return new File(context.getFilesDir(), FILE).isFile();
    }

    static String read(Context context) {
        File f = new File(context.getFilesDir(), FILE);
        try (FileInputStream in = new FileInputStream(f)) {
            byte[] data = new byte[(int) Math.min(f.length(), 64 * 1024)];
            int n = in.read(data);
            return new String(data, 0, Math.max(n, 0), StandardCharsets.UTF_8);
        } catch (Throwable e) {
            return "(laporan gak bisa dibaca: " + e + ")";
        }
    }

    static void clear(Context context) {
        //noinspection ResultOfMethodCallIgnored
        new File(context.getFilesDir(), FILE).delete();
    }
}
