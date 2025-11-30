package com.bajpai.expense.tracker.service;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import com.bajpai.expense.tracker.dto.ExpenseDto;
import com.bajpai.expense.tracker.entity.ExpenseEntity;
import com.bajpai.expense.tracker.repository.ExpenseRepository;

@Service
public class ExpenseService {

    @Autowired
    private ExpenseRepository expenseRepository;

    public Integer addNewExpense(ExpenseDto expenseObj){
        
        if(expenseObj.getDate() == null){
            LocalDate today = LocalDate.now();
            expenseObj.setDate(today.toString());
        }

        ExpenseEntity expense = new ExpenseEntity();
        expense.setAmount(expenseObj.getAmount());
        expense.setCategory(expenseObj.getCategory());
        expense.setDate(expenseObj.getDate());

        ExpenseEntity createdObj = expenseRepository.save(expense);

        return createdObj.getExpenseId();
    }

    public Map<String,Object> fetchExpense(Integer expenseId){

        ExpenseEntity expenseObj = expenseRepository.findById(expenseId).orElse(null);

        if(expenseObj == null){
            return Map.of("status",false);
        }

        return Map.of("status",true,"data",expenseObj);
    }

    public Map<String,Object> fetchAllExpense(String date , String category){

        List<ExpenseEntity> expenseList = Collections.emptyList();
        if(date != null && category != null){
            expenseList = expenseRepository.findByDateAndCategory(date,category);
        } else if(date != null){
            expenseList = expenseRepository.findByDate(date);
        } else if(category != null){
            expenseList = expenseRepository.findByCategory(category);
        } else {
            expenseList = expenseRepository.findAll();
        }

        double expenseTotal = expenseList.stream().mapToDouble(ExpenseEntity::getAmount).sum();

        List<Map<String,Object>> expenses = expenseList.stream()
            .map(e -> {
                Map<String,Object> map = new HashMap<>();
                map.put("id", e.getExpenseId());
                map.put("amount", e.getAmount());
                map.put("category", e.getCategory());
                map.put("date", e.getDate());
                map.put("description", e.getDescription());
                return map;
            })
            .collect(Collectors.toList());

        return Map.of("Total Expense",expenseTotal,"Expenses",expenses);
    }

}
