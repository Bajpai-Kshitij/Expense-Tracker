package com.bajpai.expense.tracker;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;

@SpringBootTest(properties = {"spring.autoconfigure.exclude=org.springframework.boot.autoconfigure.jdbc.DataSourceAutoConfiguration"})
class ExpenseTrackerApplicationTests {

    @Test
    void contextLoads() {
    }
}
