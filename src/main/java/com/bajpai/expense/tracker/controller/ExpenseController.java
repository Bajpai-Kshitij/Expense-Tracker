package com.bajpai.expense.tracker.controller;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

import com.bajpai.expense.tracker.dto.ExpenseDto;
import com.bajpai.expense.tracker.dto.ExpenseFetchDto;
import com.bajpai.expense.tracker.service.ExpenseService;

import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.ModelAttribute;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;



@RestController
@RequestMapping("/expense")
public class ExpenseController {

    @Autowired
    private ExpenseService expenseService;

    @PostMapping("")
    public ResponseEntity<Map<String,Object>> AddNewExpense(@RequestBody ExpenseDto expenseDto) {
        
        Integer expenseId = expenseService.addNewExpense(expenseDto);
        return ResponseEntity.ok(Map.of("id",expenseId,"message","Added"));
    }
    @GetMapping("")
    public ResponseEntity<Map<String,Object>> FetchAndFilterAllExpense(@ModelAttribute ExpenseFetchDto expenseDto) {

        Map<String,Object> expenses = expenseService.fetchAllExpense(expenseDto.date,expenseDto.category);

        Map<String,Object> response = new HashMap<>();
        response.put("status", true);
        response.putAll(expenses);

        return ResponseEntity.ok(response);
    }

    @GetMapping("/{Id}")
    public ResponseEntity<Map<String,Object>> FetchExpense(@PathVariable Integer Id) {
        
        Map<String,Object> expense = expenseService.fetchExpense(Id);
        if(expense.get("status").equals(false)){
            return ResponseEntity.badRequest().body(Map.of("status",false,"message","No Expense found with the given id"));
        }
        return ResponseEntity.ok(expense);
    }

}
