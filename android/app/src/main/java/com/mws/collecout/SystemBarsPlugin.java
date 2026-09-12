package com.mws.collecout;

import android.view.View;
import android.view.Window;

import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 系统栏桥：把安卓 edge-to-edge 的状态栏/导航栏 insets 交给 web 层做顶栏/底栏避让，
 * 并支持按主题切换状态栏图标明暗。insets 以 CSS 像素返回（已除以屏幕密度）。
 */
@CapacitorPlugin(name = "SystemBars")
public class SystemBarsPlugin extends Plugin {

    @PluginMethod
    public void insets(PluginCall call) {
        Window window = bridge.getActivity().getWindow();
        View decor = window.getDecorView();
        WindowInsetsCompat wi = ViewCompat.getRootWindowInsets(decor);
        if (wi == null) {
            call.resolve(new JSObject());
            return;
        }
        float density = bridge.getActivity().getResources().getDisplayMetrics().density;
        JSObject result = new JSObject();
        result.put("top", Math.max(0, wi.getInsets(WindowInsetsCompat.Type.statusBars()).top) / density);
        result.put("bottom", Math.max(0, wi.getInsets(WindowInsetsCompat.Type.navigationBars()).bottom) / density);
        call.resolve(result);
    }

    @PluginMethod
    public void setLight(PluginCall call) {
        Boolean light = call.getBoolean("light");
        if (light == null) {
            call.reject("缺少 light 参数");
            return;
        }
        Window window = bridge.getActivity().getWindow();
        WindowInsetsControllerCompat c = WindowCompat.getInsetsController(window, window.getDecorView());
        c.setAppearanceLightStatusBars(light);
        call.resolve();
    }
}
