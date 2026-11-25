package io.github.tendorethane_code.jalur;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.graphics.Typeface;
import android.os.Bundle;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

/**
 * Shown on the launch after a crash: the error text, "Salin" to copy it for the developer, and
 * "Coba buka lagi" to clear it and start Jalur again. Plain views, no layout files.
 */
public class CrashReportActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        final String report = CrashReport.read(this);
        int pad = (int) (16 * getResources().getDisplayMetrics().density);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(pad, pad * 2, pad, pad);

        TextView title = new TextView(this);
        title.setText("Jalur sempat error");
        title.setTextSize(20);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        root.addView(title);

        TextView hint = new TextView(this);
        hint.setText("Ketuk Salin, terus kirim teksnya ke Claude biar penyebabnya ketahuan.");
        hint.setPadding(0, pad / 2, 0, pad / 2);
        root.addView(hint);

        LinearLayout buttons = new LinearLayout(this);
        Button copy = new Button(this);
        copy.setText("Salin");
        copy.setOnClickListener(v -> {
            ClipboardManager cm = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
            cm.setPrimaryClip(ClipData.newPlainText("Jalur error", report));
            Toast.makeText(this, "Disalin", Toast.LENGTH_SHORT).show();
        });
        Button retry = new Button(this);
        retry.setText("Coba buka lagi");
        retry.setOnClickListener(v -> {
            CrashReport.clear(this);
            startActivity(new Intent(this, JalurLauncherActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            finish();
        });
        buttons.addView(copy);
        buttons.addView(retry);
        root.addView(buttons);

        TextView text = new TextView(this);
        text.setText(report);
        text.setTypeface(Typeface.MONOSPACE);
        text.setTextSize(11);
        text.setTextIsSelectable(true);
        ScrollView scroll = new ScrollView(this);
        scroll.addView(text);
        root.addView(scroll, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));

        setContentView(root);
    }
}
