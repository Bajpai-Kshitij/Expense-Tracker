package com.bajpai.expense.tracker.repository;

import java.util.List;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import com.bajpai.expense.tracker.entity.ExpenseEntity;

@Repository
public interface ExpenseRepository extends JpaRepository<ExpenseEntity, Integer> {

    List<ExpenseEntity> findByDateAndCategory(String date, String category);
    List<ExpenseEntity> findByDate(String date);
    List<ExpenseEntity> findByCategory(String category);
    

}
