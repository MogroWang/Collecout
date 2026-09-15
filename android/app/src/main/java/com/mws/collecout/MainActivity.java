package com.mws.collecout;

import android.os.Build;
import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;

import androidx.core.view.WindowCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 注册系统栏桥（须在 super.onCreate 之前）
        registerPlugin(SystemBarsPlugin.class);
        super.onCreate(savedInstanceState);
        // 全版本统一 edge-to-edge：WebView 延伸到状态栏/导航栏下，
        // API 35+ 本就强制；低版本显式开启后由 web 层的 --safe-top/--safe-bottom 避让
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        // 关闭 WebView 自动深色化（API 29–32 的 force dark）：应用的深色主题由 web 层
        // 自绘，系统强加的加深会叠加在自绘深色上导致发灰错乱与渲染异常；API 33+
        // 默认不开启 algorithmic darkening，无需处理
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            WebView webView = bridge.getWebView();
            if (webView != null) {
                webView.getSettings().setForceDark(WebSettings.FORCE_DARK_OFF);
            }
        }
    }
}
