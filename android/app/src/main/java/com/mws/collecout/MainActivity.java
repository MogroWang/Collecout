package com.mws.collecout;

import android.os.Bundle;

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
    }
}
