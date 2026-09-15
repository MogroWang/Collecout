package com.mws.collecout;

import android.app.Activity;
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
 *
 * 方法体全程兜底：插件方法跑在主线程，任何未捕获异常（如 Activity 正在重建时
 * bridge.getActivity() 返回 null）都会直接崩掉整个进程——表现为「切换主题后闪退」，
 * 因此这里不允许异常逃出，全部回落到安全默认值。
 */
@CapacitorPlugin(name = "SystemBars")
public class SystemBarsPlugin extends Plugin {

    @PluginMethod
    public void insets(PluginCall call) {
        try {
            JSObject result = readInsets();
            if (result == null) result = new JSObject();
            call.resolve(result);
        } catch (Exception e) {
            call.resolve(new JSObject());
        }
    }

    /** 读取系统栏 insets；窗口或 decor 尚不可用时返回 null（调用方回落为空对象） */
    private JSObject readInsets() {
        Activity activity = bridge.getActivity();
        Window window = activity == null ? null : activity.getWindow();
        View decor = window == null ? null : window.getDecorView();
        if (window == null || decor == null) return null;
        WindowInsetsCompat wi = ViewCompat.getRootWindowInsets(decor);
        if (wi == null) return null;
        float density = activity.getResources().getDisplayMetrics().density;
        JSObject result = new JSObject();
        result.put("top", Math.max(0, wi.getInsets(WindowInsetsCompat.Type.statusBars()).top) / density);
        result.put("bottom", Math.max(0, wi.getInsets(WindowInsetsCompat.Type.navigationBars()).bottom) / density);
        return result;
    }

    @PluginMethod
    public void setLight(PluginCall call) {
        Boolean light = call.getBoolean("light");
        if (light == null) {
            call.reject("缺少 light 参数");
            return;
        }
        try {
            Activity activity = bridge.getActivity();
            Window window = activity == null ? null : activity.getWindow();
            if (window == null || window.getDecorView() == null) {
                call.resolve();
                return;
            }
            WindowInsetsControllerCompat c = WindowCompat.getInsetsController(window, window.getDecorView());
            c.setAppearanceLightStatusBars(light);
            call.resolve();
        } catch (Exception e) {
            // 图标明暗切不动时静默放弃，绝不让异常冒泡崩掉进程
            call.resolve();
        }
    }
}
