package com.bajpai.expense.tracker;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ExpenseNativePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
